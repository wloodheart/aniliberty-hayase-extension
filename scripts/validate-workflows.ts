import { readFileSync } from "node:fs"

import { z } from "zod"

import { validateWorkflow } from "./workflow-policy.ts"
import { WorkflowSchema } from "./workflow-schema.ts"

class WorkflowInputError extends Error {
  readonly name = "WorkflowInputError"
}

function parseWorkflow(path: string): readonly string[] {
  const source = readFileSync(path, "utf8")
  let input: unknown
  try {
    input = Bun.YAML.parse(source)
  } catch (error) {
    if (error instanceof Error) return [`${path}: YAML_INVALID`]
    throw error
  }
  const parsed = WorkflowSchema.safeParse(input)
  if (!parsed.success) return [`${path}: WORKFLOW_STRUCTURE_INVALID`]
  return validateWorkflow(path, source, parsed.data)
}

function main(): void {
  const paths = Bun.argv.slice(2).filter((argument) => argument !== "--")
  if (paths.length === 0) throw new WorkflowInputError("Usage: validate-workflows.ts <path>...")
  const diagnostics = paths.flatMap(parseWorkflow)
  if (diagnostics.length > 0) {
    console.error(diagnostics.join("\n"))
    process.exitCode = 1
    return
  }
  console.log(`PASS_WORKFLOW_SECURITY ${paths.length}`)
}

try {
  main()
} catch (error) {
  if (error instanceof WorkflowInputError || error instanceof z.ZodError) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
}
