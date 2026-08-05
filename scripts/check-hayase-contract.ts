import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import {
  ContractInputError,
  ContractSyntaxError,
  compareHayaseContracts,
  parseHayaseContract,
} from "./hayase-contract-ast.ts"

const upstreamSha = "56151c710a9265f42994bd72cff007598c596bab"
const upstreamUrl = `https://raw.githubusercontent.com/hayase-app/interface/${upstreamSha}/src/lib/modules/extensions/types.d.ts`
const maximumSourceBytes = 256 * 1024

const contractSchema = z.object({
  upstreamSha: z.literal(upstreamSha),
  manifestVersion: z.literal(2),
  manifest: z.object({
    requiredKeys: z.array(z.string()),
    sourceTypes: z.array(z.string()),
    accuracyLiterals: z.array(z.string()),
    mediaLiterals: z.array(z.string()),
  }),
  animeQuery: z.object({
    requiredFields: z.array(z.string()),
    optionalFields: z.array(z.string()),
    resolutionLiterals: z.array(z.string()),
    mediaBoundary: z.string(),
    injectedFetch: z.boolean(),
  }),
  torrentResult: z.object({
    requiredFields: z.array(z.string()),
    optionalFields: z.array(z.string()),
    typeLiterals: z.array(z.string()),
  }),
  torrentSource: z.object({
    test: z.string(),
    single: z.string(),
    batch: z.string(),
    movie: z.string(),
  }),
})

class ContractNetworkError extends Error {
  readonly name = "ContractNetworkError"
}

async function fetchSource(): Promise<string> {
  const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok || response.body === null) {
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
  } else {
    throw error
  }
}
