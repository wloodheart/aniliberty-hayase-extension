import { readFileSync } from "node:fs"

import { z } from "zod"

import { normalizeAniLibertyContract } from "./aniliberty-contract.ts"
import {
  ContractEndpointDriftError,
  ContractSkipError,
  classifyContractStatus,
  classifyNetworkFixture,
  isTransportFailure,
} from "./contract-network.ts"
import { isJsonMediaType } from "./http-media-type.ts"

const defaultContractPath = "contracts/aniliberty-v1.contract.json"
const upstreamUrl = "https://anilibria.top/storage/api/docs/v1?aniliberty-api-v1-docs.json"
const maximumSourceBytes = 8 * 1024 * 1024

class ContractInputError extends Error {
  readonly name = "ContractInputError"
}

class ContractNetworkError extends Error {
  readonly name = "ContractNetworkError"
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

async function fetchContract(): Promise<unknown> {
  const response = await fetch(upstreamUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    classifyContractStatus(response.status)
  }
  if (response.body === null) {
    throw new ContractNetworkError("AniLiberty contract response has no body")
  }
  if (!isJsonMediaType(response.headers.get("content-type") ?? "")) {
    await response.body.cancel()
    throw new ContractNetworkError("AniLiberty contract response is not JSON")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteCount = 0
  let source = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteCount += chunk.value.byteLength
    if (byteCount > maximumSourceBytes) {
      await reader.cancel()
      throw new ContractNetworkError(`AniLiberty contract exceeds ${maximumSourceBytes} bytes`)
    }
    source += decoder.decode(chunk.value, { stream: true })
  }
  return JSON.parse(source + decoder.decode())
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2).filter((argument) => argument !== "--")
  const fixturePath = option(args, "--fixture")
  const networkFixturePath = option(args, "--network-fixture")
  const contractPath = option(args, "--contract") ?? defaultContractPath
  const expectedLength =
    fixturePath !== undefined
      ? contractPath === defaultContractPath
        ? 2
        : 4
      : networkFixturePath !== undefined
        ? 2
        : 0
  if (
    args.length !== expectedLength ||
    (fixturePath !== undefined && networkFixturePath !== undefined)
  ) {
    throw new ContractInputError(
      "Usage: check-aniliberty-contract.ts [--fixture <path> [--contract <path>] | --network-fixture <path>]",
    )
  }
  if (networkFixturePath !== undefined) classifyNetworkFixture(networkFixturePath)

  const actual = normalizeAniLibertyContract(
    fixturePath === undefined
      ? await fetchContract()
      : JSON.parse(readFileSync(fixturePath, "utf8")),
  )
  const expected = readFileSync(contractPath, "utf8")
  if (actual !== expected) {
    console.error(JSON.stringify({ compatible: false, path: "$", source: "contract" }))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ compatible: true, contract: "aniliberty-v1" }))
}

try {
  await main()
} catch (error) {
  if (error instanceof ContractSkipError) {
    console.log(error.token)
  } else if (error instanceof ContractEndpointDriftError) {
    console.error(error.token)
    process.exitCode = 1
  } else if (error instanceof z.ZodError) {
    console.error(
      JSON.stringify({
        compatible: false,
        issues: error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        source: "schema",
      }),
    )
    process.exitCode = 1
  } else if (error instanceof ContractInputError || error instanceof ContractNetworkError) {
    console.error(JSON.stringify({ compatible: false, message: error.message, source: error.name }))
    process.exitCode = 1
  } else if (error instanceof SyntaxError) {
    console.error(
      JSON.stringify({
        compatible: false,
        message: "AniLiberty contract is not valid JSON",
        source: error.name,
      }),
    )
    process.exitCode = 1
  } else if (isTransportFailure(error)) {
    console.log("SKIP_ENV_NETWORK")
  } else {
    throw error
  }
}
