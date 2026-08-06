import { cpSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { ReleaseCoordinates } from "./release-workflow.ts"

const releaseListSchema = z.array(
  z.strictObject({
    tagName: z.string(),
    isDraft: z.boolean(),
    isPrerelease: z.boolean(),
  }),
)
const strictTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export class ReleaseHistoryError extends Error {
  readonly name = "ReleaseHistoryError"
}

function runGh(arguments_: readonly string[], cwd: string): string {
  const result = Bun.spawnSync(["gh", ...arguments_], { cwd, stderr: "pipe", stdout: "pipe" })
  if (result.exitCode !== 0) {
    throw new ReleaseHistoryError(
      result.stderr.toString().trim() || "GitHub release command failed",
    )
  }
  return result.stdout.toString()
}

export function restoreReleaseHistory(input: {
  readonly coordinates: ReleaseCoordinates
  readonly fixtureDirectory?: string
  readonly workspace: string
}): void {
  if (input.fixtureDirectory !== undefined) {
    if (!existsSync(input.fixtureDirectory)) {
      throw new ReleaseHistoryError(
        `Release history fixture is unavailable: ${input.fixtureDirectory}`,
      )
    }
    cpSync(input.fixtureDirectory, join(input.workspace, ".release-site"), { recursive: true })
    return
  }
  const raw = runGh(
    [
      "release",
      "list",
      "--repo",
      input.coordinates.repository,
      "--limit",
      "1000",
      "--json",
      "tagName,isDraft,isPrerelease",
    ],
    input.workspace,
  )
  const releases = releaseListSchema
    .parse(JSON.parse(raw))
    .filter(
      (release) =>
        !release.isDraft && !release.isPrerelease && strictTagPattern.test(release.tagName),
    )
    .toSorted((left, right) => left.tagName.localeCompare(right.tagName))
  if (releases.length === 0) return
  const site = join(input.workspace, ".release-site")
  mkdirSync(site, { recursive: true })
  for (const release of releases) {
    const destination = join(site, release.tagName)
    mkdirSync(destination)
    runGh(
      [
        "release",
        "download",
        release.tagName,
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
  }
}
