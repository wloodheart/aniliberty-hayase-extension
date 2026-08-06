import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { verifyImmutableVersionDirectory } from "./release-integrity.ts"
import { withReleaseLockSync } from "./release-publication.ts"
import type { ReleaseCoordinates } from "./release-workflow.ts"
import { parseUniqueJson } from "./strict-json.ts"

const EXPECTED_ASSETS = ["aniliberty.mjs", "aniliberty.mjs.sha256", "provenance.json"]
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), state: z.string() })),
})
const releasePagesSchema = z.array(z.array(releaseSchema))
const strictTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export type ReleaseCommandResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export type ReleaseCommandRunner = (
  arguments_: readonly string[],
  cwd: string,
) => ReleaseCommandResult

export class ReleaseHistoryError extends Error {
  readonly name = "ReleaseHistoryError"
}

export class CurrentReleaseExistsError extends Error {
  readonly name = "CurrentReleaseExistsError"

  constructor(readonly tag: string) {
    super(`GitHub Release already exists for current tag: ${tag}`)
  }
}

const defaultCommandRunner: ReleaseCommandRunner = (arguments_, cwd) => {
  const result = Bun.spawnSync(["gh", ...arguments_], { cwd, stderr: "pipe", stdout: "pipe" })
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

function runGh(runner: ReleaseCommandRunner, arguments_: readonly string[], cwd: string): string {
  const result = runner(arguments_, cwd)
  if (result.exitCode !== 0) {
    throw new ReleaseHistoryError(result.stderr.trim() || "GitHub release command failed")
  }
  return result.stdout
}

function verifyAssets(
  tag: string,
  assets: readonly { readonly name: string; readonly state: string }[],
): void {
  const names = assets.map((asset) => asset.name).toSorted()
  if (
    JSON.stringify(names) !== JSON.stringify([...EXPECTED_ASSETS].toSorted()) ||
    assets.some((asset) => asset.state !== "uploaded")
  ) {
    throw new ReleaseHistoryError(`GitHub Release has incomplete assets: ${tag}`)
  }
}

function verifyRestoredDirectory(
  directory: string,
  coordinates: ReleaseCoordinates,
  allowCoordinate: boolean,
): void {
  for (const tag of readdirSync(directory).toSorted()) {
    if (tag === coordinates.tag && !allowCoordinate) throw new CurrentReleaseExistsError(tag)
    if (!strictTagPattern.test(tag)) {
      throw new ReleaseHistoryError(`Release history fixture contains invalid tag: ${tag}`)
    }
    verifyImmutableVersionDirectory({
      directory: join(directory, tag),
      repository: coordinates.repository,
      version: tag.slice(1),
    })
  }
}

export function restoreReleaseHistory(input: {
  readonly allowCoordinate?: boolean
  readonly commandRunner?: ReleaseCommandRunner
  readonly coordinates: ReleaseCoordinates
  readonly fixtureDirectory?: string
  readonly workspace: string
}): void {
  withReleaseLockSync(input.workspace, () => {
    const site = join(input.workspace, ".release-site")
    if (existsSync(site)) throw new ReleaseHistoryError("Release history target already exists")
    const stagingRoot = mkdtempSync(join(input.workspace, ".release-history-"))
    const stagedSite = join(stagingRoot, "site")
    mkdirSync(stagedSite)
    try {
      if (input.fixtureDirectory !== undefined) {
        cpSync(input.fixtureDirectory, stagedSite, { recursive: true })
        verifyRestoredDirectory(stagedSite, input.coordinates, input.allowCoordinate === true)
        if (readdirSync(stagedSite).length > 0) renameSync(stagedSite, site)
        return
      }
      const runner = input.commandRunner ?? defaultCommandRunner
      const raw = runGh(
        runner,
        [
          "api",
          `repos/${input.coordinates.repository}/releases?per_page=100`,
          "--paginate",
          "--slurp",
        ],
        input.workspace,
      )
      const releases = releasePagesSchema.parse(parseUniqueJson(raw)).flat()
      const tags = new Set<string>()
      for (const release of releases) {
        if (tags.has(release.tag_name)) {
          throw new ReleaseHistoryError(`Duplicate GitHub Release tag: ${release.tag_name}`)
        }
        tags.add(release.tag_name)
        if (release.tag_name === input.coordinates.tag && input.allowCoordinate !== true) {
          throw new CurrentReleaseExistsError(release.tag_name)
        }
      }
      const restorable = releases
        .filter(
          (release) =>
            !release.draft && !release.prerelease && strictTagPattern.test(release.tag_name),
        )
        .toSorted((left, right) => left.tag_name.localeCompare(right.tag_name))
      for (const release of restorable) {
        verifyAssets(release.tag_name, release.assets)
        const destination = join(stagedSite, release.tag_name)
        mkdirSync(destination)
        runGh(
          runner,
          [
            "release",
            "download",
            release.tag_name,
            "--repo",
            input.coordinates.repository,
            "--dir",
            destination,
            "--pattern",
            "aniliberty.mjs",
            "--pattern",
            "aniliberty.mjs.sha256",
            "--pattern",
            "provenance.json",
          ],
          input.workspace,
        )
        verifyImmutableVersionDirectory({
          directory: destination,
          repository: input.coordinates.repository,
          version: release.tag_name.slice(1),
        })
      }
      if (restorable.length > 0) renameSync(stagedSite, site)
    } finally {
      rmSync(stagingRoot, { force: true, recursive: true })
    }
  })
}
