import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const dependabotSchema = z.object({
  version: z.literal(2),
  updates: z
    .array(
      z.object({
        "package-ecosystem": z.enum(["bun", "github-actions"]),
        directory: z.literal("/"),
        schedule: z.object({ interval: z.literal("weekly") }),
        "open-pull-requests-limit": z.number().int().max(2),
      }),
    )
    .length(2),
})

type ValidationRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

async function validate(paths: readonly string[]): Promise<ValidationRun> {
  const process = Bun.spawn(["bun", "run", "scripts/validate-workflows.ts", ...paths], {
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

test("accepts the repository Task 11 workflows", async () => {
  // Given: the CI and scheduled contract workflows
  // When: the local structural security validator checks both files
  const result = await validate([
    ".github/workflows/ci.yml",
    ".github/workflows/contract-drift.yml",
  ])

  // Then: both satisfy the read-only deterministic workflow policy
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "PASS_WORKFLOW_SECURITY 2\n",
  })
})

test("keeps Dependabot weekly and least-noisy for Bun and actions", () => {
  // Given: the repository dependency update configuration
  const input = Bun.YAML.parse(readFileSync(".github/dependabot.yml", "utf8"))

  // When: the supported update boundary parses it
  const config = dependabotSchema.parse(input)

  // Then: exactly the Bun and GitHub Actions ecosystems are scheduled
  expect(config.updates.map((update) => update["package-ecosystem"]).toSorted()).toEqual([
    "bun",
    "github-actions",
  ])
})

test("uses a visible drift evidence directory with exact upload semantics", () => {
  // Given: the scheduled drift workflow source
  const source = readFileSync(".github/workflows/contract-drift.yml", "utf8")

  // When: its repository-controlled evidence paths are inspected
  const evidenceReferences = source.match(/drift-evidence/g) ?? []

  // Then: every producer and uploader uses the same non-hidden directory
  expect(evidenceReferences.length).toBe(5)
  expect(source).not.toContain(".drift-evidence")
})

test("rejects Oracle workflow injection bypasses with specific diagnostics", async () => {
  // Given: untrusted condition, curl-pipe-shell, and expression action input in one workflow
  // When: the structural security validator checks the adversarial fixture
  const result = await validate(["tests/fixtures/workflows/oracle-bypass.yml"])

  // Then: every independent execution path is rejected
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("JOB_CONDITION_FORBIDDEN quality")
  expect(result.stderr).toContain("RUN_COMMAND_FORBIDDEN quality.steps[1]")
  expect(result.stderr).toContain("ACTION_INPUT_EXPRESSION_FORBIDDEN actions/checkout ref")
})

test("rejects mutated drift failure semantics", async () => {
  // Given: a drift workflow whose final failure condition was weakened
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-drift-policy-"))
  const workflowDirectory = join(directory, ".github", "workflows")
  const workflowPath = join(workflowDirectory, "contract-drift.yml")
  mkdirSync(workflowDirectory, { recursive: true })
  writeFileSync(
    workflowPath,
    readFileSync(".github/workflows/contract-drift.yml", "utf8").replace(
      "if: steps.hayase.outcome == 'failure' || steps.aniliberty.outcome == 'failure' || steps.smoke.outcome == 'failure'\n        run: exit 1",
      "if: always()\n        run: exit 1",
    ),
  )

  try {
    // When: the validator checks the mutated workflow at its policy path
    const result = await validate([workflowPath])

    // Then: exact drift step semantics fail closed
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("DRIFT_SEMANTICS_EXACT")
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test.each([
  ["mutable-action.yml", "ACTION_REF_IMMUTABLE actions/checkout@v4"],
  ["write-permission.yml", "PERMISSIONS_READ_ONLY contents=write"],
  ["broad-permission.yml", "PERMISSIONS_SCOPE_FORBIDDEN actions"],
  ["missing-timeout.yml", "JOB_TIMEOUT_REQUIRED quality"],
  ["missing-concurrency.yml", "CONCURRENCY_REQUIRED"],
  ["unsafe-interpolation.yml", "RUN_EXPRESSION_FORBIDDEN quality.steps[2]"],
  ["secret-reference.yml", "SECRETS_FORBIDDEN"],
  ["missing-version-comment.yml", "ACTION_VERSION_COMMENT_REQUIRED"],
  ["unknown-step-field.yml", "STEP_WORKING_DIRECTORY_FORBIDDEN quality.steps[0]"],
  ["step-shell.yml", "STEP_SHELL_FORBIDDEN quality.steps[0]"],
  ["job-env.yml", "JOB_ENV_FORBIDDEN quality"],
  ["continue-on-error.yml", "STEP_CONTINUE_ON_ERROR_FORBIDDEN quality.steps[0]"],
  ["malformed.yml", "YAML_INVALID"],
] as const)("rejects %s with a specific diagnostic", async (fixture, diagnostic) => {
  // Given: one workflow fixture carrying the named policy violation
  // When: the validator checks it
  const result = await validate([`tests/fixtures/workflows/${fixture}`])

  // Then: the exact policy class is reported and validation fails
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe("")
  expect(result.stderr).toContain(diagnostic)
})
