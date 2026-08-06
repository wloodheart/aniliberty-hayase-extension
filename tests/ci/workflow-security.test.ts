import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

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

test.each([
  ["mutable-action.yml", "ACTION_REF_IMMUTABLE actions/checkout@v4"],
  ["write-permission.yml", "PERMISSIONS_READ_ONLY contents=write"],
  ["broad-permission.yml", "PERMISSIONS_SCOPE_FORBIDDEN actions"],
  ["missing-timeout.yml", "JOB_TIMEOUT_REQUIRED quality"],
  ["missing-concurrency.yml", "CONCURRENCY_REQUIRED"],
  ["unsafe-interpolation.yml", "RUN_EXPRESSION_FORBIDDEN quality.steps[2]"],
  ["secret-reference.yml", "SECRETS_FORBIDDEN"],
  ["missing-version-comment.yml", "ACTION_VERSION_COMMENT_REQUIRED"],
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
