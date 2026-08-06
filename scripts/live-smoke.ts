import { readFileSync } from "node:fs"

import { z } from "zod"

import { AppStatusSchema } from "../src/aniliberty/schemas.ts"

const LIVE_STATUS_URL = "https://aniliberty.top/api/v1/app/status"
const MAXIMUM_BODY_BYTES = 64 * 1024
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const jsonSchema = z.json()

const fixtureSchema = z.object({
  status: z.number().int().min(100).max(599),
  contentType: z.string(),
  body: z.json().optional(),
})

type SmokeResponse = z.infer<typeof fixtureSchema>
type SmokeResult =
  | { readonly kind: "pass"; readonly token: "PASS_API_OK" }
  | {
      readonly kind: "skip"
      readonly token: "SKIP_ENV_BLOCKED_403" | "SKIP_ENV_NETWORK" | "SKIP_ENV_TRANSIENT_HTTP"
    }
  | {
      readonly kind: "fail"
      readonly token: "FAIL_ENDPOINT_DRIFT" | "FAIL_SCHEMA_DRIFT"
    }

class SmokeInputError extends Error {
  readonly name = "SmokeInputError"
}

function assertNever(value: never): never {
  throw new SmokeInputError(`Unexpected smoke result: ${String(value)}`)
}

function classify(response: SmokeResponse): SmokeResult {
  if (response.status === 403) return { kind: "skip", token: "SKIP_ENV_BLOCKED_403" }
  if (TRANSIENT_STATUSES.has(response.status)) {
    return { kind: "skip", token: "SKIP_ENV_TRANSIENT_HTTP" }
  }
  if (response.status !== 200) return { kind: "fail", token: "FAIL_ENDPOINT_DRIFT" }
  if (!response.contentType.toLowerCase().includes("application/json")) {
    return { kind: "fail", token: "FAIL_SCHEMA_DRIFT" }
  }
  return AppStatusSchema.safeParse(response.body).success
    ? { kind: "pass", token: "PASS_API_OK" }
    : { kind: "fail", token: "FAIL_SCHEMA_DRIFT" }
}

async function readBoundedJson(
  response: Response,
): Promise<z.infer<typeof jsonSchema> | undefined> {
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteCount = 0
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteCount += chunk.value.byteLength
    if (byteCount > MAXIMUM_BODY_BYTES) {
      await reader.cancel()
      return undefined
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  try {
    return jsonSchema.parse(JSON.parse(text))
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

async function liveResponse(): Promise<SmokeResponse> {
  const response = await fetch(LIVE_STATUS_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  })
  const contentType = response.headers.get("content-type") ?? ""
  if (response.status !== 200 || !contentType.toLowerCase().includes("application/json")) {
    await response.body?.cancel()
    return { contentType, status: response.status }
  }
  return { body: await readBoundedJson(response), contentType, status: response.status }
}

function fixtureResponse(path: string): SmokeResponse {
  return fixtureSchema.parse(JSON.parse(readFileSync(path, "utf8")))
}

function emit(result: SmokeResult): void {
  switch (result.kind) {
    case "pass":
    case "skip":
      console.log(result.token)
      return
    case "fail":
      console.error(result.token)
      process.exitCode = 1
      return
    default:
      assertNever(result)
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2).filter((argument) => argument !== "--")
  if (args.length === 0) {
    try {
      emit(classify(await liveResponse()))
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
      ) {
        emit({ kind: "skip", token: "SKIP_ENV_NETWORK" })
        return
      }
      throw error
    }
    return
  }
  if (args.length === 2 && args[0] === "--fixture" && args[1] !== undefined) {
    emit(classify(fixtureResponse(args[1])))
    return
  }
  throw new SmokeInputError("Usage: live-smoke.ts [--fixture <path>]")
}

try {
  await main()
} catch (error) {
  if (
    error instanceof SmokeInputError ||
    error instanceof SyntaxError ||
    error instanceof z.ZodError
  ) {
    console.error("FAIL_FIXTURE_INVALID")
    process.exitCode = 1
  } else {
    throw error
  }
}
