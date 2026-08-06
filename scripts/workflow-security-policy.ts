import type { WorkflowJob, WorkflowPermissions, WorkflowStep } from "./workflow-schema.ts"

const APPROVED_COMMANDS = new Set([
  "bun install --frozen-lockfile",
  "bun run check",
  "bun run build",
  "bun run verify:bundle",
  "bun run release:workflow validate",
  "bun run release:workflow restore",
  "bun run release:workflow prepare",
  "bun run release:workflow verify-payload",
  "cd release-payload && sha256sum --check aniliberty.mjs.sha256",
  "mkdir -p drift-evidence",
  "bun run contract:hayase 2> drift-evidence/hayase.json",
  "bun run contract:aniliberty 2> drift-evidence/aniliberty.json",
  "bun run live:smoke 2> drift-evidence/live-smoke.txt",
  "exit 1",
  `gh release view "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" >/dev/null 2>&1 || gh release create "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --verify-tag --title "$RELEASE_TAG" --generate-notes`,
  `gh release upload "$RELEASE_TAG" release-payload/aniliberty.mjs release-payload/aniliberty.mjs.sha256 release-payload/provenance.json --repo "$RELEASE_REPOSITORY" --clobber`,
])

const ACTION_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "actions/attest-build-provenance": ["subject-path"],
  "actions/checkout": ["persist-credentials"],
  "actions/download-artifact": ["name", "path"],
  "actions/upload-artifact": [
    "name",
    "path",
    "if-no-files-found",
    "retention-days",
    "compression-level",
  ],
  "actions/upload-pages-artifact": ["path", "retention-days"],
  "actions/deploy-pages": [],
  "oven-sh/setup-bun": ["bun-version"],
}

export function stepSignature(step: WorkflowStep): string {
  return JSON.stringify([
    step.name ?? null,
    step.id ?? null,
    step.if ?? null,
    step["continue-on-error"] ?? null,
    step.env ?? null,
    step.shell ?? null,
    step["working-directory"] ?? null,
    step.uses ?? null,
    step.run ?? null,
    step.with ?? null,
  ])
}

export function validateReadOnlyPermissions(permissions: WorkflowPermissions): readonly string[] {
  const diagnostics: string[] = []
  const entries = Object.entries(permissions)
  for (const [scope, level] of entries) {
    if (level === "write") diagnostics.push(`PERMISSIONS_READ_ONLY ${scope}=write`)
    if (scope !== "contents") diagnostics.push(`PERMISSIONS_SCOPE_FORBIDDEN ${scope}`)
  }
  if (entries.find(([scope]) => scope === "contents")?.[1] !== "read") {
    diagnostics.push("PERMISSIONS_CONTENTS_READ_REQUIRED")
  }
  return diagnostics
}

export function validateAction(step: WorkflowStep, source: string): readonly string[] {
  if (step.uses === undefined) return []
  if (!/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/.test(step.uses)) {
    return [`ACTION_REF_IMMUTABLE ${step.uses}`]
  }
  const diagnostics: string[] = []
  const repository = step.uses.split("@")[0]
  if (repository === undefined || ACTION_INPUTS[repository] === undefined) {
    return [`ACTION_UNSUPPORTED ${step.uses}`]
  }
  const lines = source.split("\n").filter((line) => line.includes(`uses: ${step.uses}`))
  if (lines.length === 0 || lines.some((line) => !/#\s*v?\d+(?:\.\d+){0,2}\b/.test(line))) {
    diagnostics.push(`ACTION_VERSION_COMMENT_REQUIRED ${step.uses}`)
  }
  for (const [key, value] of Object.entries(step.with ?? {})) {
    if (!ACTION_INPUTS[repository]?.includes(key)) {
      diagnostics.push(`ACTION_INPUT_FORBIDDEN ${repository} ${key}`)
    }
    if (typeof value === "string" && value.includes("${{")) {
      diagnostics.push(`ACTION_INPUT_EXPRESSION_FORBIDDEN ${repository} ${key}`)
    }
  }
  if (repository === "actions/checkout" && step.with?.["persist-credentials"] !== false) {
    diagnostics.push("CHECKOUT_CREDENTIALS_MUST_NOT_PERSIST")
  }
  if (repository === "oven-sh/setup-bun" && step.with?.["bun-version"] !== "1.3.14") {
    diagnostics.push("BUN_VERSION_REQUIRED 1.3.14")
  }
  return diagnostics
}

export function validateStepExecution(
  jobName: string,
  index: number,
  step: WorkflowStep,
): readonly string[] {
  const diagnostics: string[] = []
  if (step.env !== undefined) diagnostics.push(`STEP_ENV_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step.shell !== undefined) diagnostics.push(`STEP_SHELL_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step["working-directory"] !== undefined) {
    diagnostics.push(`STEP_WORKING_DIRECTORY_FORBIDDEN ${jobName}.steps[${index}]`)
  }
  if (step.run !== undefined && !APPROVED_COMMANDS.has(step.run)) {
    diagnostics.push(`RUN_COMMAND_FORBIDDEN ${jobName}.steps[${index}]`)
  }
  if (step.run?.includes("${{") === true) {
    diagnostics.push(`RUN_EXPRESSION_FORBIDDEN ${jobName}.steps[${index}]`)
  }
  return diagnostics
}

export function validateReadOnlyJob(
  jobName: string,
  job: WorkflowJob,
  source: string,
): readonly string[] {
  const diagnostics: string[] = []
  if (job["timeout-minutes"] === undefined) diagnostics.push(`JOB_TIMEOUT_REQUIRED ${jobName}`)
  if (job.if !== undefined) diagnostics.push(`JOB_CONDITION_FORBIDDEN ${jobName}`)
  if (job.env !== undefined) diagnostics.push(`JOB_ENV_FORBIDDEN ${jobName}`)
  if (job.needs !== undefined) diagnostics.push(`JOB_NEEDS_FORBIDDEN ${jobName}`)
  if (job.outputs !== undefined) diagnostics.push(`JOB_OUTPUTS_FORBIDDEN ${jobName}`)
  if (job.environment !== undefined) diagnostics.push(`JOB_ENVIRONMENT_FORBIDDEN ${jobName}`)
  if (job.permissions !== undefined)
    diagnostics.push(...validateReadOnlyPermissions(job.permissions))
  for (const [index, step] of job.steps.entries()) {
    if (step.if !== undefined)
      diagnostics.push(`STEP_CONDITION_FORBIDDEN ${jobName}.steps[${index}]`)
    if (step["continue-on-error"] !== undefined) {
      diagnostics.push(`STEP_CONTINUE_ON_ERROR_FORBIDDEN ${jobName}.steps[${index}]`)
    }
    diagnostics.push(...validateStepExecution(jobName, index, step))
    diagnostics.push(...validateAction(step, source))
  }
  return diagnostics
}
