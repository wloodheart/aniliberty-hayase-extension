import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type ValidationRun = {
  readonly exitCode: number
  readonly stderr: string
}

async function validate(path: string): Promise<ValidationRun> {
  const process = Bun.spawn(["bun", "run", "scripts/validate-workflows.ts", path], {
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr }
}

test("rejects a shell override on the final protected drift failure step", async () => {
  // Given: a protected drift workflow whose final shell swallows exit 1
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-drift-shell-"))
  const workflowDirectory = join(directory, ".github", "workflows")
  const workflowPath = join(workflowDirectory, "contract-drift.yml")
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    workflowPath,
    readFileSync("tests/fixtures/workflows/drift-final-shell.yml", "utf8"),
  )

  try {
    // When: the validator checks the protected workflow
    const result = await validate(workflowPath)

    // Then: the semantic shell override is rejected specifically
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("STEP_SHELL_FORBIDDEN drift.steps[8]")
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test("applies exact CI policy through a parent-directory alias", async () => {
  // Given: a protected CI workflow reached through an alias and using pull_request_target
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-ci-alias-"))
  const workflowDirectory = join(directory, ".github", "workflows")
  const workflowPath = join(workflowDirectory, "ci.yml")
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    workflowPath,
    readFileSync("tests/fixtures/workflows/aliased-ci-pull-request-target.yml", "utf8"),
  )
  const aliasedPath = `${workflowDirectory}/../workflows/ci.yml`

  try {
    // When: the validator receives the lexical alias instead of the canonical spelling
    const result = await validate(aliasedPath)

    // Then: global trigger and protected exact-policy diagnostics both apply
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("TRIGGER_FORBIDDEN pull_request_target")
    expect(result.stderr).toContain("CI_SEMANTICS_EXACT")
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
