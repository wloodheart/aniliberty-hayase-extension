import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const buildScript = join(import.meta.dir, "../../scripts/build-release.ts")
const repositoryRoot = join(import.meta.dir, "../..")

type CliResult = {
  readonly exitCode: number
  readonly stderr: string
}

type PackageCommandResult = CliResult & { readonly stdout: string }

function createWorkspace(): string {
  const workspace = createReleaseWorkspace("aniliberty-release-cli-")
  workspaces.push(workspace)
  return workspace
}

function createCleanRepository(): string {
  const parent = mkdtempSync(join(tmpdir(), "aniliberty-release-package-"))
  workspaces.push(parent)
  const repository = join(parent, "repository")
  const excluded = [".git", ".omo", ".release-site", "dist", "node_modules", "release-payload"].map(
    (entry) => join(repositoryRoot, entry),
  )
  cpSync(repositoryRoot, repository, {
    filter: (source) =>
      excluded.every((path) => source !== path && !source.startsWith(`${path}${sep}`)),
    recursive: true,
  })
  symlinkSync(join(repositoryRoot, "node_modules"), join(repository, "node_modules"), "dir")
  return repository
}

async function runCli(workspace: string, args: readonly string[]): Promise<CliResult> {
  const process = Bun.spawn(["bun", "run", buildScript, ...args], {
    cwd: workspace,
    stderr: "pipe",
    stdout: "ignore",
  })

  return {
    exitCode: await process.exited,
    stderr: await new Response(process.stderr).text(),
  }
}

async function runPackageDryRun(
  repository: string,
  version: string,
  repositoryCoordinate: string,
): Promise<PackageCommandResult> {
  const process = Bun.spawn(
    [
      "bun",
      "run",
      "release:dry-run",
      "--",
      "--version",
      version,
      "--repository",
      repositoryCoordinate,
    ],
    { cwd: repository, stderr: "pipe", stdout: "pipe" },
  )
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true })
  }
})

describe("release CLI parsing", () => {
  test.each([
    {
      args: ["--version", "1.2.3", "--version", "2.0.0", "--repository", "example/aniliberty"],
    },
    {
      args: [
        "--version",
        "1.2.3",
        "--repository",
        "example/aniliberty",
        "--repository",
        "other/aniliberty",
      ],
    },
  ])("rejects duplicate release coordinates before output mutation", async ({ args }) => {
    // Given: an isolated workspace and duplicated CLI coordinates
    const workspace = createWorkspace()

    // When: the real release CLI parses the arguments
    const result = await runCli(workspace, args)

    // Then: it fails without publishing output
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("Duplicate release argument")
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
  })
})

describe("standalone release package command", () => {
  test("builds and verifies a complete release from a clean repository", async () => {
    // Given: an isolated authored repository with no production bundle or release output
    const repository = createCleanRepository()

    // When: the exact documented standalone package command runs
    const result = await runPackageDryRun(repository, "1.2.3", "example/aniliberty")

    // Then: verified production bytes are published with aligned manifest and provenance
    expect(result.exitCode, result.stderr).toBe(0)
    const bundle = readFileSync(join(repository, "dist", "aniliberty.mjs"))
    const versionDirectory = join(repository, ".release-site", "v1.2.3")
    const publishedBundle = readFileSync(join(versionDirectory, "aniliberty.mjs"))
    const digest = createHash("sha256").update(bundle).digest("hex")
    const manifest: unknown = JSON.parse(
      readFileSync(join(repository, ".release-site", "index.json"), "utf8"),
    )
    const provenance: unknown = JSON.parse(
      readFileSync(join(versionDirectory, "provenance.json"), "utf8"),
    )
    expect(publishedBundle).toEqual(bundle)
    expect(readFileSync(join(versionDirectory, "aniliberty.mjs.sha256"), "utf8")).toBe(
      `${digest}  aniliberty.mjs\n`,
    )
    expect(manifest).toEqual([
      expect.objectContaining({
        code: "https://example.github.io/aniliberty/v1.2.3/aniliberty.mjs",
        sha256: digest,
        version: "1.2.3",
      }),
    ])
    expect(provenance).toEqual(
      expect.objectContaining({
        artifact: "v1.2.3/aniliberty.mjs",
        repository: "example/aniliberty",
        sha256: digest,
        version: "1.2.3",
      }),
    )
  }, 60_000)

  test("refuses the same immutable version on a repeated package command", async () => {
    // Given: a clean repository after one successful standalone release
    const repository = createCleanRepository()
    const first = await runPackageDryRun(repository, "1.2.3", "example/aniliberty")
    expect(first.exitCode, first.stderr).toBe(0)
    const bundlePath = join(repository, ".release-site", "v1.2.3", "aniliberty.mjs")
    const original = readFileSync(bundlePath)

    // When: the exact command requests the same immutable version again
    const repeated = await runPackageDryRun(repository, "1.2.3", "example/aniliberty")

    // Then: overwrite fails closed and the published bytes remain unchanged
    expect(repeated.exitCode).toBe(1)
    expect(repeated.stderr).toContain("already exists")
    expect(readFileSync(bundlePath)).toEqual(original)
  }, 60_000)

  test.each([
    { repository: "example/aniliberty", version: "1.2" },
    { repository: "owner/repository", version: "1.2.3" },
  ])(
    "rejects invalid standalone coordinates without partial release output",
    async (coordinate) => {
      // Given: a clean repository and one invalid release coordinate
      const repository = createCleanRepository()

      // When: the standalone package command validates the coordinate
      const result = await runPackageDryRun(repository, coordinate.version, coordinate.repository)

      // Then: release publication fails without a site, backup, lock, or staging path
      expect(result.exitCode).toBe(1)
      expect(existsSync(join(repository, ".release-site"))).toBeFalse()
      expect(
        readdirSync(repository).filter(
          (entry) =>
            entry === ".release-site.backup" ||
            entry === ".release-site.lock" ||
            entry.startsWith(".release-site.stage-"),
        ),
      ).toEqual([])
    },
    60_000,
  )
})
