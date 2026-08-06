import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

const directories: string[] = []
const workflowSchema = z.object({
  jobs: z.object({
    release: z.object({
      steps: z.array(z.object({ name: z.string(), run: z.string().optional() })),
    }),
  }),
})

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

function createFakeGh(): {
  readonly command: string
  readonly log: string
  readonly workspace: string
} {
  const workspace = mkdtempSync(join(tmpdir(), "aniliberty-fake-gh-"))
  directories.push(workspace)
  const bin = join(workspace, "bin")
  const payload = join(workspace, "release-payload")
  const log = join(workspace, "gh-arguments.txt")
  mkdirSync(bin)
  mkdirSync(payload)
  for (const file of ["aniliberty.mjs", "aniliberty.mjs.sha256", "provenance.json"]) {
    writeFileSync(join(payload, file), file)
  }
  const executable = join(bin, "gh")
  writeFileSync(
    executable,
    '#!/bin/sh\nprintf "CALL\\n" >> "$GH_ARGUMENT_LOG"\nprintf "%s\\n" "$@" >> "$GH_ARGUMENT_LOG"\nexit "$GH_FAKE_EXIT"\n',
  )
  chmodSync(executable, 0o755)
  const workflow = workflowSchema.parse(
    Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8")),
  )
  const step = workflow.jobs.release.steps.find(
    (candidate) => candidate.name === "Publish complete immutable GitHub Release",
  )
  if (step?.run === undefined) throw new TypeError("missing release publication command")
  return { command: step.run, log, workspace }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test.each([0, 1])(
  "invokes one exact fail-on-existing release create when gh exits %i",
  async (exitCode) => {
    // Given: a fake GitHub CLI that records one success or failure invocation
    const fixture = createFakeGh()
    const environment = processEnvironment()
    const path = z.object({ PATH: z.string().default("") }).parse(environment).PATH
    const spawned = Bun.spawn(["bash", "-c", fixture.command], {
      cwd: fixture.workspace,
      env: {
        ...environment,
        GH_ARGUMENT_LOG: fixture.log,
        GH_FAKE_EXIT: String(exitCode),
        PATH: `${join(fixture.workspace, "bin")}:${path}`,
        RELEASE_REPOSITORY: "example/aniliberty",
        RELEASE_TAG: "v1.2.3",
      },
      stderr: "pipe",
      stdout: "pipe",
    })

    // When: the exact workflow publication command runs
    const actualExitCode = await spawned.exited

    // Then: one create carries all assets and failure cannot fall through to another write
    expect(actualExitCode).toBe(exitCode)
    expect(readFileSync(fixture.log, "utf8").split("\n").filter(Boolean)).toEqual([
      "CALL",
      "release",
      "create",
      "v1.2.3",
      "release-payload/aniliberty.mjs",
      "release-payload/aniliberty.mjs.sha256",
      "release-payload/provenance.json",
      "--repo",
      "example/aniliberty",
      "--verify-tag",
      "--title",
      "v1.2.3",
      "--generate-notes",
    ])
  },
)
