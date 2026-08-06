import { posix } from "node:path"

import type { Workflow, WorkflowJob, WorkflowPermissions, WorkflowStep } from "./workflow-schema.ts"

const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
const SETUP_BUN = "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76"
const UPLOAD_ARTIFACT = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
const DRIFT_FAILURE_CONDITION =
  "steps.hayase.outcome == 'failure' || steps.aniliberty.outcome == 'failure' || steps.smoke.outcome == 'failure'"
const APPROVED_COMMANDS = new Set([
  "bun install --frozen-lockfile",
  "bun run check",
  "mkdir -p drift-evidence",
  "bun run contract:hayase 2> drift-evidence/hayase.json",
  "bun run contract:aniliberty 2> drift-evidence/aniliberty.json",
  "bun run live:smoke 2> drift-evidence/live-smoke.txt",
  "exit 1",
])
const ACTION_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "actions/checkout": ["persist-credentials"],
  "actions/upload-artifact": ["name", "path", "if-no-files-found", "retention-days"],
  "oven-sh/setup-bun": ["bun-version"],
}

function normalizeWorkflowPath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/"))
}

function isPolicyPath(normalizedPath: string, fileName: string): boolean {
  return (
    normalizedPath === `.github/workflows/${fileName}` ||
    normalizedPath.endsWith(`/.github/workflows/${fileName}`)
  )
}

function hasTrigger(trigger: Workflow["on"], name: string): boolean {
  if (typeof trigger === "string") return trigger === name
  if (Array.isArray(trigger)) return trigger.includes(name)
  return Object.hasOwn(trigger, name)
}

function stepSignature(step: WorkflowStep): string {
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

const CI_STEPS = [
  { name: "Check out repository", uses: CHECKOUT, with: { "persist-credentials": false } },
  { name: "Set up Bun", uses: SETUP_BUN, with: { "bun-version": "1.3.14" } },
  { name: "Install frozen dependencies", run: "bun install --frozen-lockfile" },
  { name: "Run deterministic quality gates", run: "bun run check" },
].map(stepSignature)

const DRIFT_STEPS = [
  { name: "Check out repository", uses: CHECKOUT, with: { "persist-credentials": false } },
  { name: "Set up Bun", uses: SETUP_BUN, with: { "bun-version": "1.3.14" } },
  { name: "Install frozen dependencies", run: "bun install --frozen-lockfile" },
  { name: "Prepare drift evidence", run: "mkdir -p drift-evidence" },
  {
    name: "Compare current Hayase contract",
    id: "hayase",
    "continue-on-error": true,
    run: "bun run contract:hayase 2> drift-evidence/hayase.json",
  },
  {
    name: "Compare current AniLiberty contract",
    id: "aniliberty",
    "continue-on-error": true,
    run: "bun run contract:aniliberty 2> drift-evidence/aniliberty.json",
  },
  {
    name: "Classify live AniLiberty health",
    id: "smoke",
    "continue-on-error": true,
    run: "bun run live:smoke 2> drift-evidence/live-smoke.txt",
  },
  {
    name: "Upload confirmed drift evidence",
    if: DRIFT_FAILURE_CONDITION,
    uses: UPLOAD_ARTIFACT,
    with: {
      name: "contract-drift",
      path: "drift-evidence",
      "if-no-files-found": "error",
      "retention-days": 14,
    },
  },
  { name: "Fail on confirmed drift", if: DRIFT_FAILURE_CONDITION, run: "exit 1" },
].map(stepSignature)

function validatePermissions(permissions: WorkflowPermissions): readonly string[] {
  const diagnostics: string[] = []
  for (const [scope, level] of Object.entries(permissions)) {
    if (level === "write") diagnostics.push(`PERMISSIONS_READ_ONLY ${scope}=write`)
    if (scope !== "contents") diagnostics.push(`PERMISSIONS_SCOPE_FORBIDDEN ${scope}`)
  }
  if (permissions.contents !== "read") diagnostics.push("PERMISSIONS_CONTENTS_READ_REQUIRED")
  return diagnostics
}

function validateAction(step: WorkflowStep, source: string): readonly string[] {
  if (step.uses === undefined) return []
  const diagnostics: string[] = []
  if (!/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/.test(step.uses)) {
    return [`ACTION_REF_IMMUTABLE ${step.uses}`]
  }
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

function validateJob(jobName: string, job: WorkflowJob, source: string): readonly string[] {
  const diagnostics: string[] = []
  if (job["timeout-minutes"] === undefined) diagnostics.push(`JOB_TIMEOUT_REQUIRED ${jobName}`)
  if (job.if !== undefined) diagnostics.push(`JOB_CONDITION_FORBIDDEN ${jobName}`)
  if (job.env !== undefined) diagnostics.push(`JOB_ENV_FORBIDDEN ${jobName}`)
  if (job.permissions !== undefined) diagnostics.push(...validatePermissions(job.permissions))
  for (const [index, step] of job.steps.entries()) {
    if (step.if !== undefined)
      diagnostics.push(`STEP_CONDITION_FORBIDDEN ${jobName}.steps[${index}]`)
    if (step["continue-on-error"] !== undefined)
      diagnostics.push(`STEP_CONTINUE_ON_ERROR_FORBIDDEN ${jobName}.steps[${index}]`)
    diagnostics.push(...validateStepExecution(jobName, index, step))
    diagnostics.push(...validateAction(step, source))
  }
  return diagnostics
}

function validateStepExecution(
  jobName: string,
  index: number,
  step: WorkflowStep,
): readonly string[] {
  const diagnostics: string[] = []
  if (step.env !== undefined) diagnostics.push(`STEP_ENV_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step.shell !== undefined) diagnostics.push(`STEP_SHELL_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step["working-directory"] !== undefined)
    diagnostics.push(`STEP_WORKING_DIRECTORY_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step.run !== undefined && !APPROVED_COMMANDS.has(step.run))
    diagnostics.push(`RUN_COMMAND_FORBIDDEN ${jobName}.steps[${index}]`)
  if (step.run?.includes("${{") === true)
    diagnostics.push(`RUN_EXPRESSION_FORBIDDEN ${jobName}.steps[${index}]`)
  return diagnostics
}

function matchesJob(job: WorkflowJob, timeout: number, steps: readonly string[]): boolean {
  return (
    job.if === undefined &&
    job.env === undefined &&
    job.permissions === undefined &&
    job["runs-on"] === "ubuntu-latest" &&
    job["timeout-minutes"] === timeout &&
    JSON.stringify(job.steps.map(stepSignature)) === JSON.stringify(steps)
  )
}

export function validateWorkflow(
  path: string,
  source: string,
  workflow: Workflow,
): readonly string[] {
  const diagnostics = [...validatePermissions(workflow.permissions)]
  const normalizedPath = normalizeWorkflowPath(path)
  if (workflow.concurrency === undefined) diagnostics.push("CONCURRENCY_REQUIRED")
  if (/\$\{\{\s*secrets\./.test(source)) diagnostics.push("SECRETS_FORBIDDEN")
  if (hasTrigger(workflow.on, "pull_request_target"))
    diagnostics.push("TRIGGER_FORBIDDEN pull_request_target")
  const isDrift = isPolicyPath(normalizedPath, "contract-drift.yml")
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isDrift) diagnostics.push(...validateJob(jobName, job, source))
    else
      for (const [index, step] of job.steps.entries()) {
        diagnostics.push(...validateStepExecution(jobName, index, step))
        diagnostics.push(...validateAction(step, source))
      }
  }
  if (isPolicyPath(normalizedPath, "ci.yml")) {
    const { quality } = workflow.jobs
    const exact =
      workflow.name === "Quality" &&
      JSON.stringify(workflow.on) ===
        JSON.stringify({ pull_request: null, push: { branches: ["main"] } }) &&
      workflow.concurrency?.group === `quality-\${{ github.workflow }}-\${{ github.ref }}` &&
      Object.keys(workflow.jobs).length === 1 &&
      quality !== undefined &&
      matchesJob(quality, 15, CI_STEPS)
    if (!exact) diagnostics.push("CI_SEMANTICS_EXACT")
  }
  if (isDrift) {
    const { drift } = workflow.jobs
    const exact =
      workflow.name === "Contract drift" &&
      JSON.stringify(workflow.on) ===
        JSON.stringify({ schedule: [{ cron: "17 4 * * 1" }], workflow_dispatch: null }) &&
      workflow.concurrency?.group === "contract-drift" &&
      Object.keys(workflow.jobs).length === 1 &&
      drift !== undefined &&
      matchesJob(drift, 20, DRIFT_STEPS)
    if (!exact) diagnostics.push("DRIFT_SEMANTICS_EXACT")
  }
  return diagnostics.map((diagnostic) => `${path}: ${diagnostic}`)
}
