import type { Workflow, WorkflowJob } from "./workflow-schema.ts"
import { stepSignature } from "./workflow-security-policy.ts"

const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
const SETUP_BUN = "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76"
const UPLOAD_PAGES = "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9"
const UPLOAD_ARTIFACT = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
const DOWNLOAD_ARTIFACT = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"
const DEPLOY_PAGES = "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"
const ATTEST = "actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373"
const WRITE_CONDITION = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"
const GITHUB_TOKEN_EXPRESSION = `\${{ github.token }}`
const RELEASE_TAG_EXPRESSION = `\${{ needs.build.outputs.tag }}`
const RELEASE_REPOSITORY_EXPRESSION = `\${{ needs.build.outputs.repository }}`
const DRY_RUN_VERSION_EXPRESSION = `\${{ inputs.version }}`
const COORDINATE_VERSION_EXPRESSION = `\${{ steps.coordinates.outputs.version }}`
const COORDINATE_TAG_EXPRESSION = `\${{ steps.coordinates.outputs.tag }}`
const COORDINATE_REPOSITORY_EXPRESSION = `\${{ steps.coordinates.outputs.repository }}`
const PREPARE_SHA_EXPRESSION = `\${{ steps.prepare.outputs.sha256 }}`
const PAGE_URL_EXPRESSION = `\${{ steps.deployment.outputs.page_url }}`

const BUILD_STEPS = [
  { name: "Check out repository", uses: CHECKOUT, with: { "persist-credentials": false } },
  { name: "Set up Bun", uses: SETUP_BUN, with: { "bun-version": "1.3.14" } },
  { name: "Install frozen dependencies", run: "bun install --frozen-lockfile" },
  {
    name: "Validate release coordinates",
    id: "coordinates",
    run: "bun run release:workflow validate",
  },
  { name: "Run deterministic quality gates", run: "bun run check" },
  { name: "Build production bundle", run: "bun run build" },
  { name: "Verify production bundle", run: "bun run verify:bundle" },
  {
    name: "Restore immutable release history",
    env: { GH_TOKEN: GITHUB_TOKEN_EXPRESSION },
    run: "bun run release:workflow restore",
  },
  {
    name: "Build and inspect atomic release site",
    id: "prepare",
    run: "bun run release:workflow prepare",
  },
  {
    name: "Upload immutable Pages artifact",
    uses: UPLOAD_PAGES,
    with: { path: ".release-site", "retention-days": 1 },
  },
  {
    name: "Upload exact release payload",
    uses: UPLOAD_ARTIFACT,
    with: {
      name: "release-payload",
      path: "release-payload",
      "if-no-files-found": "error",
      "retention-days": 1,
      "compression-level": 0,
    },
  },
].map(stepSignature)

const DEPLOY_STEPS = [
  { name: "Deploy immutable Pages artifact", id: "deployment", uses: DEPLOY_PAGES },
].map(stepSignature)

const RELEASE_STEPS = [
  {
    name: "Check out repository policy",
    uses: CHECKOUT,
    with: { "persist-credentials": false },
  },
  { name: "Set up Bun", uses: SETUP_BUN, with: { "bun-version": "1.3.14" } },
  { name: "Install frozen dependencies", run: "bun install --frozen-lockfile" },
  {
    name: "Download exact release payload",
    uses: DOWNLOAD_ARTIFACT,
    with: { name: "release-payload", path: "release-payload" },
  },
  { name: "Verify downloaded release payload", run: "bun run release:workflow verify-payload" },
  {
    name: "Create release if absent",
    env: {
      GH_TOKEN: GITHUB_TOKEN_EXPRESSION,
      RELEASE_TAG: RELEASE_TAG_EXPRESSION,
      RELEASE_REPOSITORY: RELEASE_REPOSITORY_EXPRESSION,
    },
    run: `gh release view "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" >/dev/null 2>&1 || gh release create "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --verify-tag --title "$RELEASE_TAG" --generate-notes`,
  },
  {
    name: "Upload exact versioned release assets",
    env: {
      GH_TOKEN: GITHUB_TOKEN_EXPRESSION,
      RELEASE_TAG: RELEASE_TAG_EXPRESSION,
      RELEASE_REPOSITORY: RELEASE_REPOSITORY_EXPRESSION,
    },
    run: `gh release upload "$RELEASE_TAG" release-payload/aniliberty.mjs release-payload/aniliberty.mjs.sha256 release-payload/provenance.json --repo "$RELEASE_REPOSITORY" --clobber`,
  },
].map(stepSignature)

const ATTEST_STEPS = [
  {
    name: "Download exact release payload",
    uses: DOWNLOAD_ARTIFACT,
    with: { name: "release-payload", path: "release-payload" },
  },
  {
    name: "Verify bundle checksum",
    run: "cd release-payload && sha256sum --check aniliberty.mjs.sha256",
  },
  {
    name: "Attest exact published bundle",
    uses: ATTEST,
    with: { "subject-path": "release-payload/aniliberty.mjs" },
  },
].map(stepSignature)

function stepsMatch(job: WorkflowJob | undefined, expected: readonly string[]): boolean {
  return (
    job !== undefined && JSON.stringify(job.steps.map(stepSignature)) === JSON.stringify(expected)
  )
}

export function validateReleaseWorkflow(workflow: Workflow): readonly string[] {
  const { build, deploy, release, attest } = workflow.jobs
  const trigger = JSON.stringify({
    push: { tags: ["v*.*.*"] },
    workflow_dispatch: {
      inputs: {
        version: {
          description: "Package version to validate without publishing",
          required: true,
          default: "0.0.0",
          type: "string",
        },
      },
    },
  })
  const exact =
    workflow.name === "Release" &&
    JSON.stringify(workflow.on) === trigger &&
    workflow.concurrency?.group === `release-\${{ github.ref }}` &&
    Object.keys(workflow.jobs).toSorted().join(",") === "attest,build,deploy,release" &&
    build?.["runs-on"] === "ubuntu-latest" &&
    build["timeout-minutes"] === 25 &&
    JSON.stringify(build.env) ===
      JSON.stringify({ RELEASE_DRY_RUN_VERSION: DRY_RUN_VERSION_EXPRESSION }) &&
    JSON.stringify(build.outputs) ===
      JSON.stringify({
        version: COORDINATE_VERSION_EXPRESSION,
        tag: COORDINATE_TAG_EXPRESSION,
        repository: COORDINATE_REPOSITORY_EXPRESSION,
        sha256: PREPARE_SHA_EXPRESSION,
      }) &&
    build.if === undefined &&
    build.needs === undefined &&
    build.permissions === undefined &&
    build.environment === undefined &&
    stepsMatch(build, BUILD_STEPS) &&
    deploy?.if === WRITE_CONDITION &&
    deploy.needs === "build" &&
    deploy["runs-on"] === "ubuntu-latest" &&
    deploy["timeout-minutes"] === 10 &&
    deploy.env === undefined &&
    deploy.outputs === undefined &&
    JSON.stringify(deploy.permissions) ===
      JSON.stringify({ pages: "write", "id-token": "write" }) &&
    JSON.stringify(deploy.environment) ===
      JSON.stringify({ name: "github-pages", url: PAGE_URL_EXPRESSION }) &&
    stepsMatch(deploy, DEPLOY_STEPS) &&
    release?.if === WRITE_CONDITION &&
    release.needs === "build" &&
    release["runs-on"] === "ubuntu-latest" &&
    release["timeout-minutes"] === 10 &&
    release.env === undefined &&
    release.outputs === undefined &&
    JSON.stringify(release.permissions) === JSON.stringify({ contents: "write" }) &&
    release.environment === undefined &&
    stepsMatch(release, RELEASE_STEPS) &&
    attest?.if === WRITE_CONDITION &&
    attest.needs === "build" &&
    attest["runs-on"] === "ubuntu-latest" &&
    attest["timeout-minutes"] === 10 &&
    attest.env === undefined &&
    attest.outputs === undefined &&
    JSON.stringify(attest.permissions) ===
      JSON.stringify({ contents: "read", "id-token": "write", attestations: "write" }) &&
    attest.environment === undefined &&
    stepsMatch(attest, ATTEST_STEPS)
  return exact ? [] : ["RELEASE_SEMANTICS_EXACT"]
}
