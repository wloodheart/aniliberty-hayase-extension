import type { Workflow, WorkflowJob, WorkflowStep } from "./workflow-schema.ts"
import { stepSignature } from "./workflow-security-policy.ts"

const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
const SETUP_BUN = "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76"
const UPLOAD_PAGES = "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9"
const DEPLOY_PAGES = "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"
const ROLLBACK_CONDITION =
  "github.event_name == 'workflow_dispatch' && inputs.operation == 'rollback'"
const GITHUB_TOKEN_EXPRESSION = `\${{ github.token }}`
const TARGET_VERSION_EXPRESSION = `\${{ inputs.target_version }}`
const PAGE_URL_EXPRESSION = `\${{ steps.deployment.outputs.page_url }}`

const ROLLBACK_BUILD_STEPS = (
  [
    { name: "Check out repository", uses: CHECKOUT, with: { "persist-credentials": false } },
    { name: "Set up Bun", uses: SETUP_BUN, with: { "bun-version": "1.3.14" } },
    { name: "Install frozen dependencies", run: "bun install --frozen-lockfile" },
    { name: "Run deterministic rollback quality gates", run: "bun run check:rollback" },
    {
      name: "Reconstruct and verify rollback Pages tree",
      env: { GH_TOKEN: GITHUB_TOKEN_EXPRESSION },
      run: "bun run release:workflow rollback-prepare",
    },
    {
      name: "Upload verified rollback Pages artifact",
      uses: UPLOAD_PAGES,
      with: { path: ".release-site", "retention-days": 1 },
    },
  ] satisfies readonly WorkflowStep[]
).map(stepSignature)

const ROLLBACK_DEPLOY_STEPS = (
  [
    { name: "Deploy verified rollback Pages artifact", id: "deployment", uses: DEPLOY_PAGES },
  ] satisfies readonly WorkflowStep[]
).map(stepSignature)

function stepsMatch(job: WorkflowJob | undefined, expected: readonly string[]): boolean {
  return (
    job !== undefined && JSON.stringify(job.steps.map(stepSignature)) === JSON.stringify(expected)
  )
}

export function validateRollbackWorkflow(workflow: Workflow): boolean {
  const rollbackBuild = workflow.jobs["rollback-build"]
  const rollbackDeploy = workflow.jobs["rollback-deploy"]
  return (
    rollbackBuild?.if === ROLLBACK_CONDITION &&
    rollbackBuild.needs === undefined &&
    rollbackBuild["runs-on"] === "ubuntu-latest" &&
    rollbackBuild["timeout-minutes"] === 20 &&
    JSON.stringify(rollbackBuild.permissions) === JSON.stringify({ contents: "read" }) &&
    JSON.stringify(rollbackBuild.env) ===
      JSON.stringify({ ROLLBACK_TARGET_VERSION: TARGET_VERSION_EXPRESSION }) &&
    rollbackBuild.outputs === undefined &&
    rollbackBuild.environment === undefined &&
    stepsMatch(rollbackBuild, ROLLBACK_BUILD_STEPS) &&
    rollbackDeploy?.if === ROLLBACK_CONDITION &&
    rollbackDeploy.needs === "rollback-build" &&
    rollbackDeploy["runs-on"] === "ubuntu-latest" &&
    rollbackDeploy["timeout-minutes"] === 10 &&
    JSON.stringify(rollbackDeploy.permissions) ===
      JSON.stringify({ pages: "write", "id-token": "write" }) &&
    rollbackDeploy.env === undefined &&
    rollbackDeploy.outputs === undefined &&
    JSON.stringify(rollbackDeploy.environment) ===
      JSON.stringify({ name: "github-pages", url: PAGE_URL_EXPRESSION }) &&
    stepsMatch(rollbackDeploy, ROLLBACK_DEPLOY_STEPS)
  )
}
