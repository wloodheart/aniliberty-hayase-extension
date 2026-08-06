import { posix } from "node:path"

import { validateReleaseWorkflow } from "./workflow-release-policy.ts"
import type { Workflow, WorkflowJob, WorkflowStep } from "./workflow-schema.ts"
import {
  stepSignature,
  validateAction,
  validateReadOnlyJob,
  validateReadOnlyPermissions,
  validateStepExecution,
} from "./workflow-security-policy.ts"

const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
const SETUP_BUN = "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76"
const UPLOAD_ARTIFACT = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
const DRIFT_FAILURE_CONDITION =
  "steps.hayase.outcome == 'failure' || steps.aniliberty.outcome == 'failure' || steps.smoke.outcome == 'failure'"

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

function matchesJob(job: WorkflowJob, timeout: number, steps: readonly string[]): boolean {
  return (
    job.if === undefined &&
    job.env === undefined &&
    job.needs === undefined &&
    job.outputs === undefined &&
    job.environment === undefined &&
    job.permissions === undefined &&
    job["runs-on"] === "ubuntu-latest" &&
    job["timeout-minutes"] === timeout &&
    JSON.stringify(job.steps.map(stepSignature)) === JSON.stringify(steps)
  )
}

function validateDriftJob(jobName: string, job: WorkflowJob, source: string): readonly string[] {
  return job.steps.flatMap((step: WorkflowStep, index: number) => [
    ...validateStepExecution(jobName, index, step),
    ...validateAction(step, source),
  ])
}

export function validateWorkflow(
  path: string,
  source: string,
  workflow: Workflow,
): readonly string[] {
  const diagnostics = [...validateReadOnlyPermissions(workflow.permissions)]
  const normalizedPath = normalizeWorkflowPath(path)
  const isDrift = isPolicyPath(normalizedPath, "contract-drift.yml")
  const isRelease = isPolicyPath(normalizedPath, "release.yml")
  if (workflow.concurrency === undefined) diagnostics.push("CONCURRENCY_REQUIRED")
  if (/\$\{\{\s*secrets\./.test(source)) diagnostics.push("SECRETS_FORBIDDEN")
  if (hasTrigger(workflow.on, "pull_request_target")) {
    diagnostics.push("TRIGGER_FORBIDDEN pull_request_target")
  }
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (isRelease) {
      for (const step of job.steps) diagnostics.push(...validateAction(step, source))
    } else if (isDrift) diagnostics.push(...validateDriftJob(jobName, job, source))
    else diagnostics.push(...validateReadOnlyJob(jobName, job, source))
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
  if (isRelease) diagnostics.push(...validateReleaseWorkflow(workflow))
  return diagnostics.map((diagnostic) => `${path}: ${diagnostic}`)
}
