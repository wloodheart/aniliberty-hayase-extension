import { createHash } from "node:crypto"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..")
const RELEASE_VERSION = "0.0.0-test"
const RELEASE_REPOSITORY = "example/aniliberty"

export type ReleaseWorkspace = {
  readonly path: string
  readonly repository: typeof RELEASE_REPOSITORY
  readonly version: typeof RELEASE_VERSION
}

async function runTask9Command(
  workspace: string,
  script: string,
  args: readonly string[],
): Promise<void> {
  const process = Bun.spawn(["bun", "run", join(PROJECT_ROOT, "scripts", script), ...args], {
    cwd: workspace,
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  if (exitCode !== 0) throw new TypeError(`Task 9 command failed: ${script}: ${stderr.trim()}`)
}

export async function createReleaseWorkspace(): Promise<ReleaseWorkspace> {
  const path = mkdtempSync(join(tmpdir(), "aniliberty-e2e-"))
  cpSync(join(PROJECT_ROOT, "src"), join(path, "src"), { recursive: true })
  cpSync(join(PROJECT_ROOT, "assets"), join(path, "assets"), { recursive: true })
  symlinkSync(join(PROJECT_ROOT, "node_modules"), join(path, "node_modules"), "dir")

  try {
    await runTask9Command(path, "build-bundle.ts", [])
    await runTask9Command(path, "verify-bundle.ts", [])
    await runTask9Command(path, "build-release.ts", [
      "--version",
      RELEASE_VERSION,
      "--repository",
      RELEASE_REPOSITORY,
    ])
    return { path, repository: RELEASE_REPOSITORY, version: RELEASE_VERSION }
  } catch (error) {
    rmSync(path, { force: true, recursive: true })
    throw error
  }
}

export function removeReleaseWorkspace(workspace: ReleaseWorkspace | undefined): void {
  if (workspace !== undefined) rmSync(workspace.path, { force: true, recursive: true })
}

export function replaceReleaseArtifact(workspace: ReleaseWorkspace, source: string): void {
  const versionDirectory = join(workspace.path, ".release-site", `v${workspace.version}`)
  const artifactPath = join(versionDirectory, "aniliberty.mjs")
  const manifestPath = join(workspace.path, ".release-site", "index.json")
  const sha256 = createHash("sha256").update(source).digest("hex")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest[0] = { ...manifest[0], sha256 }
  writeFileSync(artifactPath, source)
  writeFileSync(join(versionDirectory, "aniliberty.mjs.sha256"), `${sha256}  aniliberty.mjs\n`)
  writeFileSync(manifestPath, JSON.stringify(manifest))
}
