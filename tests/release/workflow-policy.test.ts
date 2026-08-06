import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const directories: string[] = []
const validatorScript = join(import.meta.dir, "../../scripts/validate-workflows.ts")
const concurrencySchema = z.object({
  concurrency: z.object({ group: z.string(), "cancel-in-progress": z.boolean() }),
})
const jobsSchema = z.object({ jobs: z.record(z.string(), z.unknown()) })

type ValidationRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

async function validate(path: string, cwd = process.cwd()): Promise<ValidationRun> {
  const process = Bun.spawn(["bun", "run", validatorScript, path], {
    cwd,
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

function mutatedRollbackQualityPackage(replacement: string): string {
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-rollback-package-policy-"))
  directories.push(directory)
  const workflowDirectory = join(directory, ".github", "workflows")
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    join(directory, "package.json"),
    readFileSync("package.json", "utf8").replace(
      /"check:rollback":\s*"[^"]+"/u,
      `"check:rollback": "${replacement}"`,
    ),
  )
  writeFileSync(
    join(workflowDirectory, "release.yml"),
    readFileSync(".github/workflows/release.yml", "utf8"),
  )
  return directory
}

function mutatedRelease(search: string, replacement: string): string {
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-release-policy-"))
  directories.push(directory)
  const workflowDirectory = join(directory, ".github", "workflows")
  const path = join(workflowDirectory, "release.yml")
  mkdirSync(workflowDirectory, { recursive: true })
  const source = readFileSync(".github/workflows/release.yml", "utf8")
  writeFileSync(path, source.replace(search, replacement))
  return path
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("accepts the repository atomic release workflow", async () => {
  // Given: the Task 12 release workflow
  // When: the strict structural validator checks it
  const result = await validate(".github/workflows/release.yml")

  // Then: every release-specific security invariant passes
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "PASS_WORKFLOW_SECURITY 1\n",
  })
})

test.each([
  {
    diagnostic: "ACTION_REF_IMMUTABLE",
    replacement: "actions/deploy-pages@v5",
    search: "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "if: github.event_name == 'push'",
    search: "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "contents: write\n      actions: write",
    search: "contents: write",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "if: github.event_name == 'workflow_dispatch'",
    search: "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "cancel-in-progress: true",
    search: "cancel-in-progress: false",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: `group: release-\${{ github.ref }}`,
    search: "group: release",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "attest:\n    needs: release",
    search: "attest:\n    needs: build",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "release:\n    needs: build",
    search: "release:\n    needs:\n      - build\n      - attest",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: "deploy:\n    needs: build",
    search: "deploy:\n    needs: release",
  },
  {
    diagnostic: "RELEASE_SEMANTICS_EXACT",
    replacement: 'gh release upload "$RELEASE_TAG" release-payload/aniliberty.mjs --clobber',
    search:
      'gh release create "$RELEASE_TAG" release-payload/aniliberty.mjs release-payload/aniliberty.mjs.sha256 release-payload/provenance.json --repo "$RELEASE_REPOSITORY" --verify-tag --title "$RELEASE_TAG" --generate-notes',
  },
] as const)("rejects a release policy mutation with $diagnostic", async (fixture) => {
  // Given: a protected release workflow carrying one security mutation
  const path = mutatedRelease(fixture.search, fixture.replacement)

  // When: the release policy validates the protected path
  const result = await validate(path)

  // Then: the workflow fails closed before GitHub can schedule publication
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain(fixture.diagnostic)
})

test("keeps every write-capable job explicitly unavailable to manual dry-run", () => {
  // Given: the parsed repository release workflow
  const workflow: unknown = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"))

  // When: write scopes and their job conditions are selected structurally
  const serialized = JSON.stringify(workflow)

  // Then: no workflow_dispatch path can satisfy a write-capable job
  expect(
    serialized.match(/github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/g),
  ).toHaveLength(3)
  expect(serialized).not.toContain("github.event_name != 'workflow_dispatch'")
})

test("defines explicit dry-run and rollback dispatch inputs", () => {
  // Given: the parsed protected release workflow
  const workflow = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"))

  // When: manual operation inputs are inspected structurally
  const serialized = JSON.stringify(workflow)

  // Then: rollback is an explicit choice with an independent target version
  expect(serialized).toContain(
    '"operation":{"description":"Operation","required":true,"default":"dry-run","type":"choice","options":["dry-run","rollback"]}',
  )
  expect(serialized).toContain(
    '"target_version":{"description":"Existing version to restore on Pages","required":false,"default":"","type":"string"}',
  )
})

test("separates read-only rollback preparation from protected Pages deployment", () => {
  // Given: the parsed protected release workflow
  const workflow = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"))

  // When: rollback job structure is serialized
  const serialized = JSON.stringify(workflow)

  // Then: only the protected deploy job has rollback write permissions
  expect(serialized).toContain(
    '"rollback-build":{"if":"github.event_name == \'workflow_dispatch\' && inputs.operation == \'rollback\'"',
  )
  expect(serialized).toContain(
    '"rollback-deploy":{"needs":"rollback-build","if":"github.event_name == \'workflow_dispatch\' && inputs.operation == \'rollback\'"',
  )
  expect(serialized).toContain('"rollback-deploy":{"needs":"rollback-build"')
  expect(serialized).toContain('"permissions":{"pages":"write","id-token":"write"}')
  expect(serialized).toContain('"environment":{"name":"github-pages"')
  expect(serialized).toContain("bun run release:workflow rollback-prepare")
  expect(serialized).toContain("bun run check:rollback")
})

test.each([
  "bun run check",
  "bun run build",
  "bun run verify:bundle",
  "bun run check:rollback && bun run build",
  "bun run rollback:alias",
] as const)("rejects rollback quality command replacement %s", async (replacement) => {
  // Given: a rollback workflow whose dedicated quality command is replaced
  const path = mutatedRelease("bun run check:rollback", replacement)

  // When: exact workflow policy validates the mutation
  const result = await validate(path)

  // Then: no direct, chained, or aliased build-capable gate is eligible
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("RELEASE_SEMANTICS_EXACT")
})

test.each([
  "bun run check",
  "bun run build",
  "bun run verify:bundle",
  "bun run lint && bun run build",
] as const)("rejects transitive rollback package gate %s", async (replacement) => {
  // Given: the exact workflow with a build-capable package-script replacement
  const directory = mutatedRollbackQualityPackage(replacement)

  // When: workflow validation resolves the package command graph
  const result = await validate(".github/workflows/release.yml", directory)

  // Then: package indirection cannot hide production bundle construction
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("ROLLBACK_QUALITY_SCRIPT_EXACT")
})

test("keeps rollback free of release creation and attestation", () => {
  // Given: the parsed protected release workflow
  const workflow = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"))

  // When: rollback jobs are selected
  const record = jobsSchema.parse(workflow)
  const rollback = JSON.stringify({
    build: record.jobs["rollback-build"],
    deploy: record.jobs["rollback-deploy"],
  })

  // Then: rollback only reconstructs, verifies, uploads, and deploys Pages
  expect(record.jobs["rollback-build"]).toBeDefined()
  expect(record.jobs["rollback-deploy"]).toBeDefined()
  expect(rollback).not.toContain("gh release create")
  expect(rollback).not.toContain("attest-build-provenance")
  expect(rollback).not.toContain("bun run build")
  expect(rollback).not.toContain('bun run check"')
  expect(rollback).not.toContain("bun run verify:bundle")
  expect(rollback).not.toContain("release-payload")
})

test("serializes distinct release tags and manual dry-runs in one global group", () => {
  // Given: two version tags and one manual dry-run entering the release workflow
  const runRefs = ["refs/tags/v1.2.3", "refs/tags/v1.2.4", "refs/heads/main"] as const
  const workflow = concurrencySchema.parse(
    Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8")),
  )

  // When: GitHub derives each run's repository concurrency identity
  const groups = runRefs.map((ref) => ({ group: workflow.concurrency.group, ref }))

  // Then: every run waits in the same non-cancelling publication queue
  expect(groups).toEqual(runRefs.map((ref) => ({ group: "release", ref })))
  expect(workflow.concurrency["cancel-in-progress"]).toBeFalse()
})

test("publishes one fail-on-existing Release only after attestation and before Pages", () => {
  // Given: the parsed repository release workflow
  const workflow = Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8"))

  // When: publication commands and job dependencies are inspected
  const serialized = JSON.stringify(workflow)

  // Then: one atomic create is serialized between attestation and Pages activation
  expect(serialized).toContain('"needs":["build","attest"]')
  expect(serialized).toContain('"deploy":{"needs":"release"')
  expect(serialized).not.toContain("release upload")
  expect(serialized).not.toContain("release view")
  expect(serialized).not.toContain("--clobber")
})
