import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildRelease } from "../../scripts/build-release.ts"
import {
  type PublicationOperations,
  ReleaseLockedError,
  ReleasePublicationError,
} from "../../scripts/release-publication.ts"

const workspaces: string[] = []

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "aniliberty-publication-"))
  workspaces.push(workspace)
  mkdirSync(join(workspace, "src"))
  writeFileSync(join(workspace, "src", "index.ts"), "export default Object.freeze({})\n")
  return workspace
}

async function captureBuild(operation: Promise<void>): Promise<unknown> {
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

describe("release publication transaction", () => {
  test("allows only one concurrent distinct-version publisher", async () => {
    // Given: one published release and two new distinct versions
    const workspace = createWorkspace()
    await buildRelease({ repository: "example/aniliberty", version: "1.0.0", workspace })

    // When: both new versions attempt publication concurrently
    const results = await Promise.all([
      captureBuild(buildRelease({ repository: "example/aniliberty", version: "1.0.1", workspace })),
      captureBuild(buildRelease({ repository: "example/aniliberty", version: "1.0.2", workspace })),
    ])

    // Then: one fails fast with the typed lock error and no published version is lost
    expect(results.filter((result) => result === undefined)).toHaveLength(1)
    expect(results.some((result) => result instanceof ReleaseLockedError)).toBeTrue()
    expect(
      readdirSync(join(workspace, ".release-site")).filter((entry) => entry.startsWith("v")),
    ).toHaveLength(2)
    expect(existsSync(join(workspace, ".release-site.lock"))).toBeFalse()
  })

  test("allows only one concurrent duplicate-version publisher", async () => {
    // Given: an isolated release workspace
    const workspace = createWorkspace()

    // When: two publishers request the same version concurrently
    const results = await Promise.all([
      captureBuild(buildRelease({ repository: "example/aniliberty", version: "1.0.1", workspace })),
      captureBuild(buildRelease({ repository: "example/aniliberty", version: "1.0.1", workspace })),
    ])

    // Then: exactly one publishes and the other fails fast
    expect(results.filter((result) => result === undefined)).toHaveLength(1)
    expect(results.some((result) => result instanceof ReleaseLockedError)).toBeTrue()
    expect(
      readdirSync(join(workspace, ".release-site")).filter((entry) => entry.startsWith("v")),
    ).toEqual(["v1.0.1"])
  })

  test("cleans backup and transient resources after successful restoration", async () => {
    // Given: a previous release and one injected publication rename failure
    const workspace = createWorkspace()
    await buildRelease({ repository: "example/aniliberty", version: "1.0.0", workspace })
    let renameCount = 0
    const publication = {
      rename(source: string, destination: string): void {
        renameCount += 1
        if (renameCount === 2) {
          throw new TypeError("injected publication failure")
        }
        renameSync(source, destination)
      },
    } satisfies PublicationOperations

    // When: publication fails and restoration succeeds
    const error = await captureBuild(
      buildRelease({ repository: "example/aniliberty", version: "1.0.1", workspace }, publication),
    )

    // Then: the previous site is restored and every transient resource is removed
    expect(error).toBeInstanceOf(ReleasePublicationError)
    expect(existsSync(join(workspace, ".release-site", "v1.0.0"))).toBeTrue()
    expect(existsSync(join(workspace, ".release-site.backup"))).toBeFalse()
    expect(existsSync(join(workspace, ".release-site.lock"))).toBeFalse()
    expect(
      readdirSync(workspace).filter((entry) => entry.startsWith(".release-site.stage-")),
    ).toEqual([])
  })
})
