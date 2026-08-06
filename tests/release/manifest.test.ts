import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildRelease,
  ExistingReleaseError,
  ReleaseArtifactError,
} from "../../scripts/build-release.ts"

const workspaces: string[] = []
const prebuiltBundle = Buffer.from("export default Object.freeze({ prebuilt: true })\n")
const neutralIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n'

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "aniliberty-release-"))
  workspaces.push(workspace)
  mkdirSync(join(workspace, "dist"))
  mkdirSync(join(workspace, "assets"))
  writeFileSync(join(workspace, "dist", "aniliberty.mjs"), prebuiltBundle)
  writeFileSync(join(workspace, "assets", "aniliberty-neutral.svg"), neutralIcon)
  return workspace
}

async function captureError(operation: Promise<void>): Promise<unknown> {
  try {
    await operation
    return undefined
  } catch (error) {
    return error
  }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true })
  }
})

describe("atomic release builder", () => {
  test("writes a complete manifest, bundle, checksum, and provenance", async () => {
    // Given: an isolated workspace containing the Task 5 bundle input
    const workspace = createWorkspace()

    // When: a release site is built
    await buildRelease({ repository: "example/aniliberty", version: "1.2.3", workspace })

    // Then: every deterministic release artifact is complete and consistent
    const site = join(workspace, ".release-site")
    const versionDirectory = join(site, "v1.2.3")
    const bundle = readFileSync(join(versionDirectory, "aniliberty.mjs"))
    const digest = createHash("sha256").update(bundle).digest("hex")
    const manifest: unknown = JSON.parse(readFileSync(join(site, "index.json"), "utf8"))
    const provenance: unknown = JSON.parse(
      readFileSync(join(versionDirectory, "provenance.json"), "utf8"),
    )

    expect(manifest).toEqual([
      expect.objectContaining({
        id: "aniliberty.torrents",
        icon: `data:image/svg+xml;base64,${Buffer.from(neutralIcon).toString("base64")}`,
        sha256: digest,
        update: "https://example.github.io/aniliberty/index.json",
        code: "https://example.github.io/aniliberty/v1.2.3/aniliberty.mjs",
        url: "aHR0cHM6Ly9hbmlsaWJlcnR5LnRvcA==",
      }),
    ])
    expect(bundle).toEqual(prebuiltBundle)
    expect(readFileSync(join(versionDirectory, "aniliberty.mjs.sha256"), "utf8")).toBe(
      `${digest}  aniliberty.mjs\n`,
    )
    expect(provenance).toEqual({
      schemaVersion: 1,
      repository: "example/aniliberty",
      version: "1.2.3",
      source: "src/index.ts",
      artifact: "v1.2.3/aniliberty.mjs",
      sha256: digest,
      hayaseContract: "56151c710a9265f42994bd72cff007598c596bab",
    })
    expect(readdirSync(versionDirectory).toSorted()).toEqual([
      "aniliberty.mjs",
      "aniliberty.mjs.sha256",
      "provenance.json",
    ])
  })

  test("produces byte-identical output in independent workspaces", async () => {
    // Given: two isolated workspaces with identical source bytes
    const firstWorkspace = createWorkspace()
    const secondWorkspace = createWorkspace()

    // When: each workspace builds the same release
    await buildRelease({
      repository: "example/aniliberty",
      version: "1.2.3",
      workspace: firstWorkspace,
    })
    await buildRelease({
      repository: "example/aniliberty",
      version: "1.2.3",
      workspace: secondWorkspace,
    })

    // Then: every published file has identical bytes
    for (const relativePath of [
      "index.json",
      "v1.2.3/aniliberty.mjs",
      "v1.2.3/aniliberty.mjs.sha256",
      "v1.2.3/provenance.json",
    ]) {
      expect(readFileSync(join(firstWorkspace, ".release-site", relativePath))).toEqual(
        readFileSync(join(secondWorkspace, ".release-site", relativePath)),
      )
    }
  })

  test("refuses an existing version directory without changing the site", async () => {
    // Given: a stale version directory already exists
    const workspace = createWorkspace()
    const versionDirectory = join(workspace, ".release-site", "v1.2.3")
    mkdirSync(versionDirectory, { recursive: true })
    writeFileSync(join(versionDirectory, "stale"), "unchanged")

    // When: the same version is requested
    const build = buildRelease({ repository: "example/aniliberty", version: "1.2.3", workspace })

    // Then: overwrite is refused and existing bytes remain untouched
    expect(await captureError(build)).toBeInstanceOf(ExistingReleaseError)
    expect(readFileSync(join(versionDirectory, "stale"), "utf8")).toBe("unchanged")
    expect(existsSync(join(workspace, ".release-site", "index.json"))).toBeFalse()
  })

  test("leaves no site or staging directory when the prebuilt bundle is missing", async () => {
    // Given: an isolated workspace without its required prebuilt bundle
    const workspace = createWorkspace()
    rmSync(join(workspace, "dist", "aniliberty.mjs"))

    // When: release generation loads the prebuilt artifact
    const build = buildRelease({ repository: "example/aniliberty", version: "1.2.3", workspace })

    // Then: no partial output or temporary artifact remains
    expect(await captureError(build)).toBeInstanceOf(ReleaseArtifactError)
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
    expect(readdirSync(workspace).filter((entry) => entry.startsWith(".release-site."))).toEqual([])
  })

  test.each([
    { repository: "example/aniliberty", version: "1.2" },
    { repository: "", version: "1.2.3" },
  ])("does not mutate output for invalid coordinates", async ({ repository, version }) => {
    // Given: invalid release coordinates and an isolated workspace
    const workspace = createWorkspace()

    // When: release generation validates its input
    const build = buildRelease({ repository, version, workspace })

    // Then: no release or staging output is created
    expect(await captureError(build)).toBeInstanceOf(Error)
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
    expect(readdirSync(workspace).filter((entry) => entry.startsWith(".release-site."))).toEqual([])
  })
})
