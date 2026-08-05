import { API } from "typescript/unstable/async"

import type { HayaseContract } from "./hayase-contract-model.ts"
import { normalizeHayaseSource } from "./hayase-contract-normalize.ts"

export class ContractInputError extends Error {
  readonly name = "ContractInputError"
}

export class ContractSyntaxError extends Error {
  readonly name = "ContractSyntaxError"

  constructor(readonly diagnosticCount: number) {
    super(`Hayase declaration source has ${diagnosticCount} syntax diagnostic(s)`)
  }
}

export async function parseHayaseContract(
  filePath: string,
  upstreamSha: string,
): Promise<HayaseContract> {
  const api = new API({ cwd: process.cwd() })
  try {
    const snapshot = await api.updateSnapshot({ openFiles: [filePath] })
    try {
      const project = await snapshot.getDefaultProjectForFile(filePath)
      if (project === undefined) {
        throw new ContractInputError(`No TypeScript project for ${filePath}`)
      }
      const diagnostics = await project.program.getSyntacticDiagnostics(filePath)
      if (diagnostics.length > 0) throw new ContractSyntaxError(diagnostics.length)
      const sourceFile = await project.program.getSourceFile(filePath)
      if (sourceFile === undefined) throw new ContractInputError(`Unable to parse ${filePath}`)
      return normalizeHayaseSource(sourceFile, upstreamSha)
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await api.close()
  }
}
