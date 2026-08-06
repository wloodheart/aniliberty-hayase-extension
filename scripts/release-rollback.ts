import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  createReleaseManifest,
  parseGitHubRepository,
  parsePublicationVersion,
} from "../src/release/model.ts"
import { restoreReleaseHistory } from "./release-history.ts"
import { verifyImmutableVersionDirectory, verifyReleaseSite } from "./release-integrity.ts"
import type { ReleaseCoordinates } from "./release-workflow.ts"

export type RollbackCoordinateInput = {
  readonly eventName: string
  readonly ref: string
  readonly repository: string
  readonly targetVersion: string
}

export class RollbackCoordinateError extends Error {
  readonly name = "RollbackCoordinateError"
}

export class RollbackTargetMissingError extends Error {
  readonly name = "RollbackTargetMissingError"

  constructor(readonly tag: string) {
    super(`Verified rollback target is absent from release history: ${tag}`)
  }
}

export function parseRollbackCoordinates(input: RollbackCoordinateInput): ReleaseCoordinates {
  if (input.eventName !== "workflow_dispatch" || input.ref !== "refs/heads/main") {
    throw new RollbackCoordinateError("Rollback requires workflow_dispatch on refs/heads/main")
  }
  const repository = parseGitHubRepository(input.repository).slug
  const version = parsePublicationVersion(input.targetVersion)
  return Object.freeze({
    eligible: false,
    repository,
    tag: `v${version}`,
    version: String(version),
  })
}

export function prepareRollbackArtifacts(input: {
  readonly coordinates: ReleaseCoordinates
  readonly fixtureDirectory?: string
  readonly workspace: string
}): { readonly sha256: string } {
  restoreReleaseHistory({
    allowCoordinate: true,
    coordinates: input.coordinates,
    ...(input.fixtureDirectory === undefined ? {} : { fixtureDirectory: input.fixtureDirectory }),
    workspace: input.workspace,
  })
  const site = join(input.workspace, ".release-site")
  const target = join(site, input.coordinates.tag)
  if (!existsSync(target)) throw new RollbackTargetMissingError(input.coordinates.tag)
  const sha256 = verifyImmutableVersionDirectory({
    directory: target,
    repository: input.coordinates.repository,
    version: input.coordinates.version,
  })
  const icon = readFileSync(join(input.workspace, "assets", "aniliberty-neutral.svg"))
  const manifest = createReleaseManifest(
    parsePublicationVersion(input.coordinates.version),
    parseGitHubRepository(input.coordinates.repository),
    { icon: `data:image/svg+xml;base64,${icon.toString("base64")}`, sha256 },
  )
  writeFileSync(join(site, "index.json"), `${JSON.stringify([manifest], null, 2)}\n`)
  return verifyReleaseSite(input)
}
