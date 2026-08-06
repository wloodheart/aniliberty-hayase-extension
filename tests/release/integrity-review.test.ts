import { afterEach, expect, test } from "bun:test"
import {
  cpSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import {
  verifyReleasePayloadDirectory,
  verifyReleaseSite,
} from "../../scripts/release-integrity.ts"
import {
  parseReleaseCoordinates,
  prepareReleaseArtifacts,
  type ReleaseCoordinates,
} from "../../scripts/release-workflow.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const fixturePackage = join(import.meta.dir, "../fixtures/release/package-1.2.3.json")

async function preparedRelease(): Promise<{
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}> {
  const workspace = createReleaseWorkspace("aniliberty-integrity-review-")
  workspaces.push(workspace)
  cpSync(fixturePackage, join(workspace, "package.json"))
  const coordinates = parseReleaseCoordinates({
    eventName: "push",
    ref: "refs/tags/v1.2.3",
    repository: "example/aniliberty",
    workspace,
  })
  await prepareReleaseArtifacts({ coordinates, workspace })
  return { coordinates, workspace }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true })
})

test.each(["missing-id", "wrong-manifest-version", "unexpected-property"] as const)(
  "rejects strict manifest mutation %s",
  async (mutation) => {
    // Given: a valid generated release with one manifest mutation
    const input = await preparedRelease()
    const indexPath = join(input.workspace, ".release-site", "index.json")
    const manifest = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(readFileSync(indexPath, "utf8")))
    const entry = manifest[0]
    if (entry === undefined) throw new TypeError("missing test manifest")
    if (mutation === "missing-id") Reflect.deleteProperty(entry, "id")
    else if (mutation === "wrong-manifest-version") Reflect.set(entry, "manifestVersion", 999)
    else Reflect.set(entry, "unexpected", true)
    writeFileSync(indexPath, `${JSON.stringify(manifest)}\n`)

    // When: the Pages release boundary verifies the mutated manifest
    const verify = (): unknown => verifyReleaseSite(input)

    // Then: the complete strict manifest contract rejects it
    expect(verify).toThrow()
  },
)

test.each(["symlink", "hard-link"] as const)("rejects an index %s", async (linkType) => {
  // Given: a release whose stable manifest is linked
  const input = await preparedRelease()
  const indexPath = join(input.workspace, ".release-site", "index.json")
  const retained = join(input.workspace, "retained-index.json")
  if (linkType === "symlink") {
    renameSync(indexPath, retained)
    symlinkSync(retained, indexPath)
  } else linkSync(indexPath, retained)

  // When: Pages layout integrity is verified
  const verify = (): unknown => verifyReleaseSite(input)

  // Then: symbolic and multiply-linked manifests fail closed
  expect(verify).toThrow()
})

test("rejects a symbolic version directory", async () => {
  // Given: an immutable version path replaced by a directory symlink
  const input = await preparedRelease()
  const versionPath = join(input.workspace, ".release-site", input.coordinates.tag)
  const retained = join(input.workspace, "retained-version")
  renameSync(versionPath, retained)
  symlinkSync(retained, versionPath, "dir")

  // When: Pages layout integrity is verified
  const verify = (): unknown => verifyReleaseSite(input)

  // Then: the linked version directory is rejected
  expect(verify).toThrow()
})

test.each(["symlink", "hard-link"] as const)("rejects a version artifact %s", async (linkType) => {
  // Given: an immutable bundle with a second filesystem identity
  const input = await preparedRelease()
  const bundle = join(input.workspace, ".release-site", input.coordinates.tag, "aniliberty.mjs")
  const retained = join(input.workspace, "retained-bundle.mjs")
  if (linkType === "symlink") {
    renameSync(bundle, retained)
    symlinkSync(retained, bundle)
  } else linkSync(bundle, retained)

  // When: Pages layout integrity is verified
  const verify = (): unknown => verifyReleaseSite(input)

  // Then: linked version artifacts are rejected
  expect(verify).toThrow()
})

test.each(["symlink", "hard-link"] as const)("rejects a payload artifact %s", async (linkType) => {
  // Given: a release payload whose bundle is linked
  const input = await preparedRelease()
  const bundle = join(input.workspace, "release-payload", "aniliberty.mjs")
  const retained = join(input.workspace, "retained-payload.mjs")
  if (linkType === "symlink") {
    renameSync(bundle, retained)
    symlinkSync(retained, bundle)
  } else linkSync(bundle, retained)
  // When: release payload integrity is verified
  const verify = (): unknown => verifyReleasePayloadDirectory(input)

  // Then: linked upload subjects are rejected
  expect(verify).toThrow()
})
