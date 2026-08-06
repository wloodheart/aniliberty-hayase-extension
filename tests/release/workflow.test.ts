import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildRelease } from "../../scripts/build-release.ts"
import { verifyReleaseSite } from "../../scripts/release-integrity.ts"
import {
  parseReleaseCoordinates,
  prepareReleaseArtifacts,
  verifyReleasePayload,
} from "../../scripts/release-workflow.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const fixturePackage = join(import.meta.dir, "../fixtures/release/package-1.2.3.json")

function createWorkspace(): string {
  const workspace = createReleaseWorkspace("aniliberty-release-workflow-")
  workspaces.push(workspace)
  cpSync(fixturePackage, join(workspace, "package.json"))
  return workspace
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true })
})

describe("release coordinates", () => {
  test("accepts an immutable tag when package and tag versions agree", () => {
    // Given: a strict release tag and matching package metadata
    const workspace = createWorkspace()

    // When: repository-controlled validation parses the event boundary
    const coordinates = parseReleaseCoordinates({
      eventName: "push",
      ref: "refs/tags/v1.2.3",
      repository: "example/aniliberty",
      workspace,
    })

    // Then: publication is eligible with normalized release coordinates
    expect(coordinates).toEqual({
      eligible: true,
      repository: "example/aniliberty",
      tag: "v1.2.3",
      version: "1.2.3",
    })
  })

  test("keeps a matching manual run permanently ineligible for publication", () => {
    // Given: a manual dry-run for the package version
    const workspace = createWorkspace()

    // When: the manual event is parsed
    const coordinates = parseReleaseCoordinates({
      dryRunVersion: "1.2.3",
      eventName: "workflow_dispatch",
      ref: "refs/heads/main",
      repository: "example/aniliberty",
      workspace,
    })

    // Then: it has deterministic coordinates but no write eligibility
    expect(coordinates).toEqual({
      eligible: false,
      repository: "example/aniliberty",
      tag: "v1.2.3",
      version: "1.2.3",
    })
  })

  test.each([
    { dryRunVersion: undefined, ref: "refs/tags/v1.2", version: "1.2.3" },
    { dryRunVersion: undefined, ref: "refs/tags/v1.2.4", version: "1.2.3" },
    { dryRunVersion: "1.2.4", ref: "refs/heads/main", version: "1.2.3" },
  ])("rejects malformed or mismatched coordinates before output mutation", async (fixture) => {
    // Given: package metadata that differs from an invalid event coordinate
    const workspace = createWorkspace()
    writeFileSync(
      join(workspace, "package.json"),
      `${JSON.stringify({ name: "fixture", version: fixture.version })}\n`,
    )

    // When: the event boundary is parsed
    const parse = (): unknown =>
      parseReleaseCoordinates({
        ...(fixture.dryRunVersion === undefined ? {} : { dryRunVersion: fixture.dryRunVersion }),
        eventName: fixture.dryRunVersion === undefined ? "push" : "workflow_dispatch",
        ref: fixture.ref,
        repository: "example/aniliberty",
        workspace,
      })

    // Then: validation fails before a release site can exist
    expect(parse).toThrow()
    expect(await Bun.file(join(workspace, ".release-site")).exists()).toBeFalse()
  })

  test.each([
    '{"version":"9.9.9","version":"1.2.3"}',
    '{"version":"1.2.3","version":"9.9.9"}',
    '{"name":"version: harmless","version":"1.2.3","ver\\u0073ion":"1.2.3"}',
  ])("rejects duplicate package version keys before output mutation", async (packageJson) => {
    // Given: package metadata with lexically duplicated version coordinates
    const workspace = createWorkspace()
    writeFileSync(join(workspace, "package.json"), packageJson)

    // When: release coordinates parse the raw package boundary
    const parse = (): unknown =>
      parseReleaseCoordinates({
        eventName: "push",
        ref: "refs/tags/v1.2.3",
        repository: "example/aniliberty",
        workspace,
      })

    // Then: duplicate coordinates fail before release output exists
    expect(parse).toThrow()
    expect(await Bun.file(join(workspace, ".release-site")).exists()).toBeFalse()
  })

  test.each(["{", '{"version":"1.2.3-beta"}', '{"version":"1.2.3+build"}'])(
    "rejects malformed or non-release package metadata before output mutation",
    async (packageJson) => {
      // Given: invalid raw package metadata
      const workspace = createWorkspace()
      writeFileSync(join(workspace, "package.json"), packageJson)

      // When: release coordinates parse the package boundary
      const parse = (): unknown =>
        parseReleaseCoordinates({
          eventName: "push",
          ref: "refs/tags/v1.2.3",
          repository: "example/aniliberty",
          workspace,
        })

      // Then: validation fails without output mutation
      expect(parse).toThrow()
      expect(await Bun.file(join(workspace, ".release-site")).exists()).toBeFalse()
    },
  )
})

describe("publishable release payload", () => {
  test("preserves accumulated immutable versions and rejects moving root artifacts", async () => {
    // Given: a previously published immutable version in the release workspace
    const workspace = createWorkspace()
    await buildRelease({ repository: "example/aniliberty", version: "1.2.2", workspace })
    const coordinates = parseReleaseCoordinates({
      eventName: "push",
      ref: "refs/tags/v1.2.3",
      repository: "example/aniliberty",
      workspace,
    })

    // When: the next release is prepared and a moving branch artifact is injected
    await prepareReleaseArtifacts({ coordinates, workspace })
    writeFileSync(join(workspace, ".release-site", "main.mjs"), "moving")

    // Then: both immutable versions remain but the publishable layout fails closed
    expect(readdirSync(join(workspace, ".release-site")).toSorted()).toEqual([
      "index.json",
      "main.mjs",
      "v1.2.2",
      "v1.2.3",
    ])
    expect(() => verifyReleaseSite({ coordinates, workspace })).toThrow()
  })

  test("prepares one exact immutable version with four aligned digest locations", async () => {
    // Given: matching validated release coordinates and prebuilt bytes
    const workspace = createWorkspace()
    const coordinates = parseReleaseCoordinates({
      eventName: "push",
      ref: "refs/tags/v1.2.3",
      repository: "example/aniliberty",
      workspace,
    })

    // When: the existing atomic builder prepares and verifies publication artifacts
    const result = await prepareReleaseArtifacts({ coordinates, workspace })

    // Then: the Pages and release payloads contain the same independently hashed bundle
    const bundle = readFileSync(join(workspace, "release-payload", "aniliberty.mjs"))
    const digest = createHash("sha256").update(bundle).digest("hex")
    expect(result.sha256).toBe(digest)
    expect(readFileSync(join(workspace, ".release-site", "v1.2.3", "aniliberty.mjs"))).toEqual(
      bundle,
    )
    expect(verifyReleasePayload({ coordinates, workspace }).sha256).toBe(digest)
  })

  test.each(["missing-checksum", "payload-mutation"] as const)(
    "rejects %s before publication eligibility",
    async (mutation) => {
      // Given: a completely prepared release payload
      const workspace = createWorkspace()
      const coordinates = parseReleaseCoordinates({
        eventName: "push",
        ref: "refs/tags/v1.2.3",
        repository: "example/aniliberty",
        workspace,
      })
      await prepareReleaseArtifacts({ coordinates, workspace })
      const payload = join(workspace, "release-payload")
      if (mutation === "missing-checksum") rmSync(join(payload, "aniliberty.mjs.sha256"))
      else writeFileSync(join(payload, "aniliberty.mjs"), "mutated")

      // When: the exact payload is re-verified immediately before a write-capable job
      const verify = (): unknown => verifyReleasePayload({ coordinates, workspace })

      // Then: no mutated or incomplete payload is eligible
      expect(verify).toThrow()
    },
  )
})
