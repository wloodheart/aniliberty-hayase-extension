import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import {
  ContractInputError,
  ContractSyntaxError,
  parseHayaseContract,
} from "./hayase-contract-ast.ts"
import { compareHayaseContracts } from "./hayase-contract-model.ts"

const upstreamSha = "56151c710a9265f42994bd72cff007598c596bab"
const upstreamUrl =
  "https://raw.githubusercontent.com/hayase-app/interface/main/src/lib/modules/extensions/types.d.ts"
const maximumSourceBytes = 256 * 1024
const propertySchema = z.object({
  optional: z.boolean(),
  type: z.string(),
})
const propertiesSchema = z.record(z.string(), propertySchema)

const contractSchema = z.object({
  upstreamSha: z.literal(upstreamSha),
  manifestVersion: z.literal(2),
  manifest: propertiesSchema,
  animeQuery: propertiesSchema,
  torrentResult: propertiesSchema,
  torrentSource: propertiesSchema,
})

class ContractNetworkError extends Error {
  readonly name = "ContractNetworkError"
}

async function fetchSource(): Promise<string> {
  const response = await fetch(upstreamUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    throw new ContractNetworkError(`Hayase source request failed with status ${response.status}`)
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
      throw new ContractNetworkError(`Hayase source exceeds ${maximumSourceBytes} bytes`)
    }
    source += decoder.decode(chunk.value, { stream: true })
  }
  return source + decoder.decode()
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2).filter((argument) => argument !== "--")
  const fixturePath = args.length === 2 && args[0] === "--fixture" ? args[1] : undefined
  if (args.length !== 0 && fixturePath === undefined) {
    throw new ContractInputError("Usage: check-hayase-contract.ts [--fixture <path>]")
  }
  const expected = contractSchema.parse(
    JSON.parse(readFileSync("contracts/hayase-extension-contract.json", "utf8")),
  )
  let temporaryDirectory: string | undefined
  try {
    let filePath = fixturePath
    if (filePath === undefined) {
      temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-hayase-contract-"))
      filePath = join(temporaryDirectory, "types.d.ts")
      writeFileSync(filePath, await fetchSource())
    }
    const differences = compareHayaseContracts(
      expected,
      await parseHayaseContract(filePath, upstreamSha),
    )
    if (differences.length > 0) {
      console.error(JSON.stringify({ compatible: false, differences }))
      process.exitCode = 1
      return
    }
    console.log(
      JSON.stringify({
        compatible: true,
        source: fixturePath === undefined ? "network" : "fixture",
        upstreamSha,
      }),
    )
  } finally {
    if (temporaryDirectory !== undefined) {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof ContractSyntaxError) {
    console.error(
      JSON.stringify({ compatible: false, diagnostics: error.diagnosticCount, source: "syntax" }),
    )
    process.exitCode = 1
  } else if (error instanceof ContractInputError || error instanceof ContractNetworkError) {
    console.error(JSON.stringify({ compatible: false, message: error.message, source: error.name }))
    process.exitCode = 1
  } else if (
    error instanceof TypeError ||
    (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
  ) {
    console.error(
      JSON.stringify({
        compatible: false,
        message: "Hayase source request failed",
        source: "ContractNetworkError",
      }),
    )
    process.exitCode = 1
  } else {
    throw error
  }
}
