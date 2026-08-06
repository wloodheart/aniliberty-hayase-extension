import { cpSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { parseGitHubRepository } from "../src/release/model.ts"
import { buildRelease } from "./build-release.ts"
import { restoreReleaseHistory } from "./release-history.ts"
import { verifyReleasePayloadDirectory, verifyReleaseSite } from "./release-integrity.ts"
import { parseRollbackCoordinates, prepareRollbackArtifacts } from "./release-rollback.ts"
import { parseUniqueJson } from "./strict-json.ts"

export { parseRollbackCoordinates, prepareRollbackArtifacts } from "./release-rollback.ts"

const strictVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const packageSchema = z.object({ version: strictVersionSchema })
const eventSchema = z.enum(["push", "workflow_dispatch"])
const environmentSchema = z.object({
  RELEASE_DRY_RUN_VERSION: z.string().optional(),
  GITHUB_EVENT_NAME: z.string().default(""),
  GITHUB_REF: z.string().default(""),
  GITHUB_REPOSITORY: z.string().default(""),
  GITHUB_OUTPUT: z.string().optional(),
  RELEASE_HISTORY_FIXTURE: z.string().optional(),
  ROLLBACK_TARGET_VERSION: z.string().optional(),
})

export type ReleaseCoordinates = {
  readonly eligible: boolean
  readonly repository: string
  readonly tag: string
  readonly version: string
}

export type ReleaseCoordinateInput = {
  readonly dryRunVersion?: string
  readonly eventName: string
  readonly ref: string
  readonly repository: string
  readonly workspace: string
}

export class ReleaseCoordinateError extends Error {
  readonly name = "ReleaseCoordinateError"
}

export function parseReleaseCoordinates(input: ReleaseCoordinateInput): ReleaseCoordinates {
  const eventName = eventSchema.parse(input.eventName)
  const repository = parseGitHubRepository(input.repository).slug
  const packageMetadata = packageSchema.parse(
    parseUniqueJson(readFileSync(join(input.workspace, "package.json"), "utf8")),
  )
  const tag =
    eventName === "push" ? input.ref.replace(/^refs\/tags\//, "") : `v${input.dryRunVersion}`
  const tagMatch = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/.exec(tag)
  if (
    tagMatch === null ||
    tagMatch[1] !== packageMetadata.version ||
    (eventName === "push" && input.ref !== `refs/tags/${tag}`) ||
    (eventName === "workflow_dispatch" && input.ref !== "refs/heads/main")
  ) {
    throw new ReleaseCoordinateError("Release event, tag, and package version must agree")
  }
  return Object.freeze({
    eligible: eventName === "push",
    repository,
    tag,
    version: packageMetadata.version,
  })
}

export async function prepareReleaseArtifacts(input: {
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}): Promise<{ readonly sha256: string }> {
  await buildRelease({
    repository: input.coordinates.repository,
    version: input.coordinates.version,
    workspace: input.workspace,
  })
  const site = verifyReleaseSite(input)
  const payload = join(input.workspace, "release-payload")
  rmSync(payload, { force: true, recursive: true })
  cpSync(join(input.workspace, ".release-site", input.coordinates.tag), payload, {
    recursive: true,
  })
  const verifiedPayload = verifyReleasePayloadDirectory(input)
  if (verifiedPayload.sha256 !== site.sha256) {
    throw new ReleaseCoordinateError("Pages and GitHub Release digests differ")
  }
  return site
}

export function verifyReleasePayload(input: {
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}): { readonly sha256: string } {
  return verifyReleasePayloadDirectory(input)
}

function environmentCoordinates(): ReleaseCoordinates {
  const environment = environmentSchema.parse(process.env)
  const dryRunVersion = environment.RELEASE_DRY_RUN_VERSION
  return parseReleaseCoordinates({
    ...(dryRunVersion === undefined ? {} : { dryRunVersion }),
    eventName: environment.GITHUB_EVENT_NAME,
    ref: environment.GITHUB_REF,
    repository: environment.GITHUB_REPOSITORY,
    workspace: process.cwd(),
  })
}

function rollbackEnvironmentCoordinates(): ReleaseCoordinates {
  const environment = environmentSchema.parse(process.env)
  return parseRollbackCoordinates({
    eventName: environment.GITHUB_EVENT_NAME,
    ref: environment.GITHUB_REF,
    repository: environment.GITHUB_REPOSITORY,
    targetVersion: environment.ROLLBACK_TARGET_VERSION ?? "",
  })
}

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env)
  const [mode] = Bun.argv.slice(2).filter((argument) => argument !== "--")
  if (mode === "rollback-prepare") {
    const coordinates = rollbackEnvironmentCoordinates()
    const result = prepareRollbackArtifacts({
      coordinates,
      ...(environment.RELEASE_HISTORY_FIXTURE === undefined
        ? {}
        : { fixtureDirectory: environment.RELEASE_HISTORY_FIXTURE }),
      workspace: process.cwd(),
    })
    console.log(result.sha256)
    return
  }
  const coordinates = environmentCoordinates()
  if (mode === "validate") {
    const output = environment.GITHUB_OUTPUT
    const lines = `version=${coordinates.version}\ntag=${coordinates.tag}\nrepository=${coordinates.repository}\nsha256=pending\n`
    if (output === undefined) console.log(JSON.stringify(coordinates))
    else await Bun.write(Bun.file(output), lines)
    return
  }
  if (mode === "restore") {
    restoreReleaseHistory({
      coordinates,
      ...(environment.RELEASE_HISTORY_FIXTURE === undefined
        ? {}
        : { fixtureDirectory: environment.RELEASE_HISTORY_FIXTURE }),
      workspace: process.cwd(),
    })
    return
  }
  if (mode === "prepare") {
    const result = await prepareReleaseArtifacts({ coordinates, workspace: process.cwd() })
    const output = environment.GITHUB_OUTPUT
    if (output !== undefined) await Bun.write(Bun.file(output), `sha256=${result.sha256}\n`)
    else console.log(result.sha256)
    return
  }
  if (mode === "verify-payload") {
    console.log(verifyReleasePayload({ coordinates, workspace: process.cwd() }).sha256)
    return
  }
  throw new ReleaseCoordinateError(
    "Expected validate, restore, prepare, verify-payload, or rollback-prepare mode",
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  })
}
