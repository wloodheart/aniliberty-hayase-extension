import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildRelease } from "../../scripts/build-release.ts"
import { verifyReleaseSite } from "../../scripts/release-integrity.ts"
import {
  parseRollbackCoordinates,
  prepareRollbackArtifacts,
} from "../../scripts/release-workflow.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const fixturePackage = join(import.meta.dir, "../fixtures/release/package-1.2.3.json")

function workspace(prefix: string): string {
  const path = createReleaseWorkspace(prefix)
  workspaces.push(path)
  cpSync(fixturePackage, join(path, "package.json"))
  return path
}

async function historyFixture(repository = "example/aniliberty"): Promise<string> {
  const source = workspace("aniliberty-rollback-source-")
  await buildRelease({ repository, version: "1.2.1", workspace: source })
  await buildRelease({ repository, version: "1.2.2", workspace: source })
  const fixture = join(source, "history")
  mkdirSync(fixture)
  for (const tag of ["v1.2.1", "v1.2.2"]) {
    cpSync(join(source, ".release-site", tag), join(fixture, tag), { recursive: true })
  }
  return fixture
}

function coordinates(targetVersion = "1.2.1") {
  const target = workspace("aniliberty-rollback-target-")
  return {
    target,
    value: parseRollbackCoordinates({
      eventName: "workflow_dispatch",
      ref: "refs/heads/main",
      repository: "example/aniliberty",
      targetVersion,
    }),
  }
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe("rollback coordinates", () => {
  test("accepts a prior target independently of the current package version", () => {
    // Given: a main-branch rollback dispatch targeting a prior semantic version
    const input = coordinates("1.2.1")

    // When: rollback coordinates are parsed
    const result = input.value

    // Then: preparation remains non-publishing and selects the immutable prior tag
    expect(result).toEqual({
      eligible: false,
      repository: "example/aniliberty",
      tag: "v1.2.1",
      version: "1.2.1",
    })
  })

  test.each([
    { eventName: "push", ref: "refs/tags/v1.2.1", targetVersion: "1.2.1" },
    { eventName: "workflow_dispatch", ref: "refs/heads/feature", targetVersion: "1.2.1" },
    { eventName: "workflow_dispatch", ref: "refs/heads/main", targetVersion: "1.2" },
  ])("rejects malformed or unprotected rollback coordinates", (input) => {
    // Given: rollback input outside the protected strict-semver boundary
    // When: coordinates are parsed
    const parse = (): unknown =>
      parseRollbackCoordinates({ ...input, repository: "example/aniliberty" })

    // Then: no rollback coordinate is produced
    expect(parse).toThrow()
  })
})

describe("rollback artifact preparation", () => {
  test("preserves complete history and changes only the stable manifest selection", async () => {
    // Given: two verified immutable releases and a prior rollback target
    const fixture = await historyFixture()
    const input = coordinates()
    const before = ["v1.2.1", "v1.2.2"].map((tag) =>
      readFileSync(join(fixture, tag, "aniliberty.mjs")),
    )

    // When: rollback preparation reconstructs and verifies the Pages tree
    const result = prepareRollbackArtifacts({
      coordinates: input.value,
      fixtureDirectory: fixture,
      workspace: input.target,
    })

    // Then: every immutable byte remains and only index.json selects the prior version
    expect(readdirSync(join(input.target, ".release-site")).toSorted()).toEqual([
      "index.json",
      "v1.2.1",
      "v1.2.2",
    ])
    expect(
      ["v1.2.1", "v1.2.2"].map((tag) =>
        readFileSync(join(input.target, ".release-site", tag, "aniliberty.mjs")),
      ),
    ).toEqual(before)
    const manifest: unknown = JSON.parse(
      readFileSync(join(input.target, ".release-site", "index.json"), "utf8"),
    )
    expect(manifest).toEqual([
      expect.objectContaining({
        code: "https://example.github.io/aniliberty/v1.2.1/aniliberty.mjs",
        sha256: result.sha256,
        update: "https://example.github.io/aniliberty/index.json",
        version: "1.2.1",
      }),
    ])
    expect(verifyReleaseSite({ coordinates: input.value, workspace: input.target })).toEqual(result)
  })

  test("rejects a missing rollback target without publishing a site", async () => {
    // Given: verified history that doesn't contain the requested target
    const fixture = await historyFixture()
    const input = coordinates("1.2.0")

    // When: rollback preparation selects the absent version
    const prepare = (): unknown =>
      prepareRollbackArtifacts({
        coordinates: input.value,
        fixtureDirectory: fixture,
        workspace: input.target,
      })

    // Then: preparation fails closed
    expect(prepare).toThrow()
  })

  test.each(["foreign-provenance", "missing-asset", "changed-bundle"] as const)(
    "rejects %s before rollback publication",
    async (mutation) => {
      // Given: complete history with one immutable target corruption
      const fixture = await historyFixture(
        mutation === "foreign-provenance" ? "other/aniliberty" : "example/aniliberty",
      )
      if (mutation === "missing-asset") {
        rmSync(join(fixture, "v1.2.1", "aniliberty.mjs.sha256"))
      } else if (mutation === "changed-bundle") {
        writeFileSync(join(fixture, "v1.2.1", "aniliberty.mjs"), "changed")
      }
      const input = coordinates()

      // When: restored history is verified before index generation
      const prepare = (): unknown =>
        prepareRollbackArtifacts({
          coordinates: input.value,
          fixtureDirectory: fixture,
          workspace: input.target,
        })

      // Then: no corrupt history becomes a Pages rollback artifact
      expect(prepare).toThrow()
    },
  )
})
