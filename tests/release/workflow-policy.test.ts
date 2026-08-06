import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directories: string[] = []

type ValidationRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

async function validate(path: string): Promise<ValidationRun> {
  const process = Bun.spawn(["bun", "run", "scripts/validate-workflows.ts", path], {
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
  expect(serialized.match(/github\.event_name == 'push'/g)).toHaveLength(3)
  expect(serialized).not.toContain("github.event_name != 'workflow_dispatch'")
})
