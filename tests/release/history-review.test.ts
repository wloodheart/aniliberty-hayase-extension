import { afterEach, expect, test } from "bun:test"
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildRelease } from "../../scripts/build-release.ts"
import {
  CurrentReleaseExistsError,
  type ReleaseCommandRunner,
  ReleaseHistoryError,
  restoreReleaseHistory,
} from "../../scripts/release-history.ts"
import { ReleaseLockedError } from "../../scripts/release-publication.ts"
import type { ReleaseCoordinates } from "../../scripts/release-workflow.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []
const coordinates = {
  eligible: true,
  repository: "example/aniliberty",
  tag: "v1.2.3",
  version: "1.2.3",
} satisfies ReleaseCoordinates
const assetNames = ["aniliberty.mjs", "aniliberty.mjs.sha256", "provenance.json"] as const

function release(tag: string, state?: { readonly draft?: boolean; readonly prerelease?: boolean }) {
  return {
    tag_name: tag,
    draft: state?.draft ?? false,
    prerelease: state?.prerelease ?? false,
    assets: assetNames.map((name) => ({ name, state: "uploaded" })),
  }
}

function createWorkspace(prefix: string): string {
  const workspace = createReleaseWorkspace(prefix)
  workspaces.push(workspace)
  return workspace
}

function flagValue(arguments_: readonly string[], flag: string): string {
  const value = arguments_[arguments_.indexOf(flag) + 1]
  if (value === undefined) throw new TypeError(`missing ${flag}`)
  return value
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true })
})

test("restores every complete published semver release from all API pages", async () => {
  // Given: two paginated release records and exact immutable source assets
  const workspace = createWorkspace("aniliberty-history-target-")
  const source = createWorkspace("aniliberty-history-source-")
  await buildRelease({ repository: coordinates.repository, version: "1.2.1", workspace: source })
  await buildRelease({ repository: coordinates.repository, version: "1.2.2", workspace: source })
  const calls: string[][] = []
  const runner: ReleaseCommandRunner = (arguments_) => {
    calls.push([...arguments_])
    if (arguments_[0] === "api") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([[release("v1.2.1")], [release("v1.2.2")]]),
      }
    }
    const tag = arguments_[2]
    const destination = flagValue(arguments_, "--dir")
    if (tag === undefined) throw new TypeError("missing download tag")
    cpSync(join(source, ".release-site", tag), destination, { recursive: true })
    return { exitCode: 0, stderr: "", stdout: "" }
  }

  // When: history restoration consumes the complete paginated API response
  restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: every immutable version is restored through exact paginated commands
  expect(calls[0]).toEqual([
    "api",
    "repos/example/aniliberty/releases?per_page=100",
    "--paginate",
    "--slurp",
  ])
  expect(readdirSync(join(workspace, ".release-site")).toSorted()).toEqual(["v1.2.1", "v1.2.2"])
})

test.each([
  { draft: false, prerelease: false },
  { draft: true, prerelease: false },
  { draft: false, prerelease: true },
])("rejects the current tag in every release state", (state) => {
  // Given: the current tag already exists in one GitHub release state
  const workspace = createWorkspace("aniliberty-history-conflict-")
  const runner: ReleaseCommandRunner = () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify([[release(coordinates.tag, state)]]),
  })

  // When: history restoration evaluates release coordinate conflicts
  const restore = (): unknown =>
    restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: publication stops before filesystem mutation
  expect(restore).toThrow(CurrentReleaseExistsError)
  expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
})

test.each([
  [[release("v1.2.2"), release("v1.2.2")]],
  [[{ tag_name: "v1.2.2" }]],
  [{ malformed: true }],
  [[{ ...release("v1.2.2"), assets: release("v1.2.2").assets.slice(1) }]],
])("rejects duplicate, malformed, or incomplete release history", (pages) => {
  // Given: an invalid paginated release response
  const workspace = createWorkspace("aniliberty-history-invalid-")
  const runner: ReleaseCommandRunner = () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify(pages),
  })

  // When: history restoration parses the untrusted API boundary
  const restore = (): unknown =>
    restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: it fails closed before creating a release site
  expect(restore).toThrow()
  expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
})

test.each(["api", "download"] as const)(
  "propagates %s failure without partial history",
  (failure) => {
    // Given: a deterministic GitHub command failure
    const workspace = createWorkspace("aniliberty-history-failure-")
    const runner: ReleaseCommandRunner = (arguments_) => {
      if (failure === "api" || arguments_[0] !== "api") {
        return { exitCode: 1, stderr: `${failure} denied`, stdout: "" }
      }
      return { exitCode: 0, stderr: "", stdout: JSON.stringify([[release("v1.2.2")]]) }
    }

    // When: history restoration reaches the failed command
    const restore = (): unknown =>
      restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

    // Then: the typed failure is surfaced and no complete site is published
    expect(restore).toThrow(ReleaseHistoryError)
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
  },
)

test("rejects downloaded assets with foreign provenance before publication", async () => {
  // Given: a release record whose downloaded assets belong to another repository
  const workspace = createWorkspace("aniliberty-history-foreign-target-")
  const source = createWorkspace("aniliberty-history-foreign-source-")
  await buildRelease({ repository: "other/aniliberty", version: "1.2.2", workspace: source })
  const runner: ReleaseCommandRunner = (arguments_) => {
    if (arguments_[0] === "api") {
      return { exitCode: 0, stderr: "", stdout: JSON.stringify([[release("v1.2.2")]]) }
    }
    cpSync(join(source, ".release-site", "v1.2.2"), flagValue(arguments_, "--dir"), {
      recursive: true,
    })
    return { exitCode: 0, stderr: "", stdout: "" }
  }

  // When: restored assets are validated before site publication
  const restore = (): unknown =>
    restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: foreign metadata fails and no partial site remains
  expect(restore).toThrow()
  expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
})

test("rejects a successful download command that leaves a partial asset set", () => {
  // Given: complete API metadata but a downloader that writes only one asset
  const workspace = createWorkspace("aniliberty-history-partial-")
  const runner: ReleaseCommandRunner = (arguments_) => {
    if (arguments_[0] === "api") {
      return { exitCode: 0, stderr: "", stdout: JSON.stringify([[release("v1.2.2")]]) }
    }
    writeFileSync(join(flagValue(arguments_, "--dir"), "aniliberty.mjs"), "partial")
    return { exitCode: 0, stderr: "", stdout: "" }
  }

  // When: restored assets are verified after the successful command
  const restore = (): unknown =>
    restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: partial history is rejected and removed
  expect(restore).toThrow()
  expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
})

test("refuses history publication while another release operation holds the workspace lock", () => {
  // Given: another release operation owns the shared publication lock
  const workspace = createWorkspace("aniliberty-history-locked-")
  writeFileSync(join(workspace, ".release-site.lock"), "held")
  const runner: ReleaseCommandRunner = () => ({ exitCode: 0, stderr: "", stdout: "[]" })

  // When: history restoration attempts to publish into the same workspace
  const restore = (): unknown =>
    restoreReleaseHistory({ commandRunner: runner, coordinates, workspace })

  // Then: it fails before reading or replacing release history
  expect(restore).toThrow(ReleaseLockedError)
  expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
})
