import { readFileSync } from "node:fs"

import { z } from "zod"

const permissionSchema = z.enum(["none", "read", "write"])
const permissionsSchema = z.object({ contents: permissionSchema }).catchall(permissionSchema)
const stepValueSchema = z.union([z.boolean(), z.number(), z.string()])
const stepSchema = z.object({
  env: z.record(z.string(), stepValueSchema).optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), stepValueSchema).optional(),
})
const jobSchema = z.object({
  "runs-on": z.string(),
  "timeout-minutes": z.number().positive().optional(),
  permissions: permissionsSchema.optional(),
  steps: z.array(stepSchema),
})
const triggerSchema = z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])
const workflowSchema = z.object({
  name: z.string().min(1),
  on: triggerSchema,
  permissions: permissionsSchema,
  concurrency: z
    .object({ group: z.string().min(1), "cancel-in-progress": z.literal(true) })
    .optional(),
  jobs: z.record(z.string(), jobSchema),
})

type Workflow = z.infer<typeof workflowSchema>
type WorkflowPermissions = z.infer<typeof permissionsSchema>

class WorkflowInputError extends Error {
  readonly name = "WorkflowInputError"
}

function hasTrigger(trigger: Workflow["on"], name: string): boolean {
  if (typeof trigger === "string") return trigger === name
  if (Array.isArray(trigger)) return trigger.includes(name)
  return Object.hasOwn(trigger, name)
}

function actionHasVersionComment(source: string, action: string): boolean {
  const lines = source.split("\n")
  const lineIndexes = lines.flatMap((line, index) =>
    line.includes(`uses: ${action}`) ? [index] : [],
  )
  return (
    lineIndexes.length > 0 &&
    lineIndexes.every((lineIndex) => {
      const current = lines[lineIndex] ?? ""
      const previous = lineIndex > 0 ? (lines[lineIndex - 1] ?? "") : ""
      return /#\s*v?\d+(?:\.\d+){0,2}\b/.test(current) || /#\s*v?\d+(?:\.\d+){0,2}\b/.test(previous)
    })
  )
}

function validatePermissions(permissions: WorkflowPermissions): readonly string[] {
  const diagnostics: string[] = []
  for (const [scope, level] of Object.entries(permissions)) {
    if (level === "write") diagnostics.push(`PERMISSIONS_READ_ONLY ${scope}=write`)
    if (scope !== "contents") diagnostics.push(`PERMISSIONS_SCOPE_FORBIDDEN ${scope}`)
  }
  if (permissions.contents !== "read") diagnostics.push("PERMISSIONS_CONTENTS_READ_REQUIRED")
  return diagnostics
}

function validateWorkflow(path: string, source: string, workflow: Workflow): readonly string[] {
  const diagnostics = [...validatePermissions(workflow.permissions)]
  if (workflow.concurrency === undefined) diagnostics.push("CONCURRENCY_REQUIRED")
  if (hasTrigger(workflow.on, "pull_request_target"))
    diagnostics.push("TRIGGER_FORBIDDEN pull_request_target")
  if (/\$\{\{\s*secrets\./.test(source)) diagnostics.push("SECRETS_FORBIDDEN")

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (job["timeout-minutes"] === undefined) diagnostics.push(`JOB_TIMEOUT_REQUIRED ${jobName}`)
    if (job.permissions !== undefined) diagnostics.push(...validatePermissions(job.permissions))
    for (const [stepIndex, step] of job.steps.entries()) {
      if (step.run?.includes("${{") === true) {
        diagnostics.push(`RUN_EXPRESSION_FORBIDDEN ${jobName}.steps[${stepIndex}]`)
      }
      if (
        step.env !== undefined &&
        Object.values(step.env).some((value) => typeof value === "string" && value.includes("${{"))
      ) {
        diagnostics.push(`ENV_EXPRESSION_FORBIDDEN ${jobName}.steps[${stepIndex}]`)
      }
      if (step.uses === undefined) continue
      if (!/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/.test(step.uses)) {
        diagnostics.push(`ACTION_REF_IMMUTABLE ${step.uses}`)
        continue
      }
      if (!actionHasVersionComment(source, step.uses)) {
        diagnostics.push(`ACTION_VERSION_COMMENT_REQUIRED ${step.uses}`)
      }
      if (step.uses.startsWith("oven-sh/setup-bun@") && step.with?.["bun-version"] !== "1.3.14") {
        diagnostics.push("BUN_VERSION_REQUIRED 1.3.14")
      }
      if (
        step.uses.startsWith("actions/checkout@") &&
        step.with?.["persist-credentials"] !== false
      ) {
        diagnostics.push("CHECKOUT_CREDENTIALS_MUST_NOT_PERSIST")
      }
    }
  }
  const runs = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])),
  )
  if (path.endsWith("/.github/workflows/ci.yml") || path === ".github/workflows/ci.yml") {
    if (!hasTrigger(workflow.on, "pull_request") || !hasTrigger(workflow.on, "push")) {
      diagnostics.push("CI_TRIGGERS_REQUIRED")
    }
    const frozenInstallIndex = runs.indexOf("bun install --frozen-lockfile")
    const fullCheckIndex = runs.indexOf("bun run check")
    if (frozenInstallIndex === -1) diagnostics.push("FROZEN_INSTALL_REQUIRED")
    if (fullCheckIndex === -1) diagnostics.push("FULL_CHECK_REQUIRED")
    if (frozenInstallIndex >= fullCheckIndex && fullCheckIndex !== -1) {
      diagnostics.push("FROZEN_INSTALL_MUST_PRECEDE_CHECK")
    }
  }
  if (
    path.endsWith("/.github/workflows/contract-drift.yml") ||
    path === ".github/workflows/contract-drift.yml"
  ) {
    if (!hasTrigger(workflow.on, "schedule") || !hasTrigger(workflow.on, "workflow_dispatch")) {
      diagnostics.push("DRIFT_TRIGGERS_REQUIRED")
    }
    for (const command of [
      "bun run contract:hayase 2> .drift-evidence/hayase.json",
      "bun run contract:aniliberty 2> .drift-evidence/aniliberty.json",
      "bun run live:smoke 2> .drift-evidence/live-smoke.txt",
    ]) {
      if (!runs.includes(command)) diagnostics.push(`DRIFT_COMMAND_REQUIRED ${command}`)
    }
  }
  return diagnostics.map((diagnostic) => `${path}: ${diagnostic}`)
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
  const parsed = workflowSchema.safeParse(input)
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
  if (error instanceof WorkflowInputError) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
}
