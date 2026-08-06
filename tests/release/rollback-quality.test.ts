import { afterEach, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, sep } from "node:path"

import { buildRelease } from "../../scripts/build-release.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const repositoryRoot = join(import.meta.dir, "../..")

function isolatedRepository(): string {
  const parent = mkdtempSync(join(tmpdir(), "aniliberty-rollback-quality-"))
  workspaces.push(parent)
  const target = join(parent, "repository")
  const excluded = [".git", ".release-site", "dist", "node_modules", "release-payload"].map(
    (entry) => join(repositoryRoot, entry),
  )
  cpSync(repositoryRoot, target, {
    filter: (source) =>
      excluded.every((path) => source !== path && !source.startsWith(`${path}${sep}`)),
    recursive: true,
  })
  symlinkSync(join(repositoryRoot, "node_modules"), join(target, "node_modules"), "dir")
  return target
}

async function execute(command: readonly string[], cwd: string, environment = process.env) {
  const child = Bun.spawn([...command], { cwd, env: environment, stderr: "pipe", stdout: "pipe" })
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true })
})

test("dedicated rollback quality and preparation never construct the root production bundle", async () => {
  // Given: an isolated repository with dependencies but no root publication outputs
  const repository = isolatedRepository()
  const source = createReleaseWorkspace("aniliberty-rollback-quality-history-")
  workspaces.push(source)
  await buildRelease({ repository: "example/aniliberty", version: "1.2.1", workspace: source })
  const fixture = join(source, "history")
  mkdirSync(fixture)
  cpSync(join(source, ".release-site", "v1.2.1"), join(fixture, "v1.2.1"), { recursive: true })

  // When: the exact protected quality command and offline rollback preparation execute
  const quality = await execute(["bun", "run", "check:rollback"], repository)
  const prepare = await execute(
    ["bun", "run", "release:workflow", "rollback-prepare"],
    repository,
    {
      ...process.env,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "example/aniliberty",
      RELEASE_HISTORY_FIXTURE: fixture,
      ROLLBACK_TARGET_VERSION: "1.2.1",
    },
  )

  // Then: validation and preparation succeed without creating any production bundle directory
  expect(quality.exitCode).toBe(0)
  expect(quality.stderr).not.toContain("error:")
  expect(prepare.exitCode).toBe(0)
  expect(prepare.stderr).not.toContain("error:")
  expect(await Bun.file(join(repository, ".release-site", "index.json")).exists()).toBeTrue()
  expect(await Bun.file(join(repository, "dist")).exists()).toBeFalse()
  expect(await Bun.file(join(repository, "release-payload")).exists()).toBeFalse()
  expect(basename(repository)).toBe("repository")
}, 60_000)
