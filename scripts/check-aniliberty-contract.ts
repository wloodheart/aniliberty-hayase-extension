import { readFileSync } from "node:fs"

import { z } from "zod"

import { normalizeAniLibertyContract } from "./aniliberty-contract.ts"

const defaultContractPath = "contracts/aniliberty-v1.contract.json"

class ContractInputError extends Error {
  readonly name = "ContractInputError"
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function main(): void {
  const args = Bun.argv.slice(2).filter((argument) => argument !== "--")
  const fixturePath = option(args, "--fixture")
  const contractPath = option(args, "--contract") ?? defaultContractPath
  const expectedLength = contractPath === defaultContractPath ? 2 : 4
  if (fixturePath === undefined || args.length !== expectedLength) {
    throw new ContractInputError(
      "Usage: check-aniliberty-contract.ts --fixture <path> [--contract <path>]",
    )
  }

  const actual = normalizeAniLibertyContract(JSON.parse(readFileSync(fixturePath, "utf8")))
  const expected = readFileSync(contractPath, "utf8")
  if (actual !== expected) {
    console.error(JSON.stringify({ compatible: false, path: "$", source: "contract" }))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ compatible: true, contract: "aniliberty-v1" }))
}

try {
  main()
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(
      JSON.stringify({
        compatible: false,
        issues: error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        source: "schema",
      }),
    )
    process.exitCode = 1
  } else if (error instanceof ContractInputError || error instanceof SyntaxError) {
    console.error(JSON.stringify({ compatible: false, message: error.message, source: error.name }))
    process.exitCode = 1
  } else {
    throw error
  }
}
