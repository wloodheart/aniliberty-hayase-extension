import { afterEach, expect, test } from "bun:test"
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const script = join(import.meta.dir, "../../scripts/release-workflow.ts")
const fixturePackage = join(import.meta.dir, "../fixtures/release/package-1.2.3.json")

type CliRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

function createWorkspace(): string {
  const workspace = createReleaseWorkspace("aniliberty-release-workflow-cli-")
  workspaces.push(workspace)
  cpSync(fixturePackage, join(workspace, "package.json"))
  return workspace
}

async function run(
  workspace: string,
  mode: string,
  extraEnv?: Record<string, string>,
): Promise<CliRun> {
  const process = Bun.spawn(["bun", "run", script, mode], {
    cwd: workspace,
    env: {
      ...processEnv(),
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "example/aniliberty",
      RELEASE_DRY_RUN_VERSION: "1.2.3",
      ...extraEnv,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true })
})

test("runs the complete manual build and inspection path without publication", async () => {
  // Given: a matching manual event and isolated prebuilt artifact workspace
  const workspace = createWorkspace()

  // When: the real workflow CLI prepares the Pages and release payloads
  const result = await run(workspace, "prepare")

  // Then: deterministic artifacts are produced without any write eligibility
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout.trim()).toMatch(/^[a-f0-9]{64}$/)
  expect(await Bun.file(join(workspace, ".release-site", "index.json")).exists()).toBeTrue()
})

test("restores an existing version fixture without contacting GitHub", async () => {
  // Given: an offline history fixture containing the requested immutable version
  const workspace = createWorkspace()
  const fixture = join(workspace, "history-fixture")
  mkdirSync(join(fixture, "v1.2.3"), { recursive: true })

  // When: restore runs through the real CLI boundary
  const restore = await run(workspace, "restore", { RELEASE_HISTORY_FIXTURE: fixture })

  // Then: restoration itself refuses the current release coordinate
  expect(restore.exitCode).toBe(1)
  expect(restore.stderr).toContain("already exists")
})

test("rejects a mismatched manual version before creating output", async () => {
  // Given: a dry-run input that differs from package metadata
  const workspace = createWorkspace()

  // When: the real coordinate-validation CLI runs
  const result = await run(workspace, "validate", { RELEASE_DRY_RUN_VERSION: "1.2.4" })

  // Then: it fails without contacting GitHub or creating release output
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("must agree")
  expect(await Bun.file(join(workspace, ".release-site")).exists()).toBeFalse()
})
