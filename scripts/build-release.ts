import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  createReleaseManifest,
  parseGitHubRepository,
  parseReleaseVersion,
} from "../src/release/model.ts"
import {
  type PublicationOperations,
  publishStagedSite,
  recoverPublicationState,
  withReleaseLock,
} from "./release-publication.ts"

const BUNDLE_NAME = "aniliberty.mjs"
const CONTRACT_SHA = "56151c710a9265f42994bd72cff007598c596bab"

export type ReleaseBuildInput = {
  readonly repository: string
  readonly version: string
  readonly workspace: string
}

type ReleaseProvenance = {
  readonly schemaVersion: 1
  readonly repository: string
  readonly version: string
  readonly source: "src/index.ts"
  readonly artifact: string
  readonly sha256: string
  readonly hayaseContract: typeof CONTRACT_SHA
}

export class ExistingReleaseError extends Error {
  readonly name = "ExistingReleaseError"

  constructor(readonly versionDirectory: string) {
    super(`Release version directory already exists: ${versionDirectory}`)
  }
}

export class ReleaseBuildError extends Error {
  readonly name = "ReleaseBuildError"

  constructor(readonly diagnostics: readonly string[]) {
    super(`Bundle generation failed: ${diagnostics.join(" | ")}`)
  }
}

export class CliArgumentError extends Error {
  readonly name = "CliArgumentError"

  constructor(readonly argument: string) {
    super(`Invalid release argument: ${argument}`)
  }
}

export class DuplicateCliArgumentError extends Error {
  readonly name = "DuplicateCliArgumentError"

  constructor(readonly argument: string) {
    super(`Duplicate release argument: ${argument}`)
  }
}

export async function buildRelease(
  input: ReleaseBuildInput,
  publication?: PublicationOperations,
): Promise<void> {
  const version = parseReleaseVersion(input.version)
  const repository = parseGitHubRepository(input.repository)
  const manifest = createReleaseManifest(version, repository)
  const siteDirectory = join(input.workspace, ".release-site")
  const backupDirectory = join(input.workspace, ".release-site.backup")
  const versionName = `v${version}`

  await withReleaseLock(input.workspace, async () => {
    recoverPublicationState({ siteDirectory, backupDirectory }, publication)

    const publishedVersionDirectory = join(siteDirectory, versionName)
    if (existsSync(publishedVersionDirectory)) {
      throw new ExistingReleaseError(publishedVersionDirectory)
    }

    const stagingDirectory = mkdtempSync(join(input.workspace, ".release-site.stage-"))
    const stagedSiteDirectory = join(stagingDirectory, "site")

    try {
      if (existsSync(siteDirectory)) {
        cpSync(siteDirectory, stagedSiteDirectory, { recursive: true })
      } else {
        mkdirSync(stagedSiteDirectory)
      }

      const stagedVersionDirectory = join(stagedSiteDirectory, versionName)
      mkdirSync(stagedVersionDirectory)
      let build: Bun.BuildOutput
      try {
        build = await Bun.build({
          entrypoints: [join(input.workspace, "src", "index.ts")],
          format: "esm",
          minify: true,
          naming: BUNDLE_NAME,
          outdir: stagedVersionDirectory,
          root: input.workspace,
          target: "browser",
        })
      } catch (error) {
        if (error instanceof Error) {
          throw new ReleaseBuildError([error.message])
        }
        throw error
      }

      if (!build.success) {
        throw new ReleaseBuildError(build.logs.map((log) => log.message))
      }

      const bundle = readFileSync(join(stagedVersionDirectory, BUNDLE_NAME))
      const sha256 = createHash("sha256").update(bundle).digest("hex")
      const provenance = Object.freeze({
        schemaVersion: 1,
        repository: repository.slug,
        version: String(version),
        source: "src/index.ts",
        artifact: `${versionName}/${BUNDLE_NAME}`,
        sha256,
        hayaseContract: CONTRACT_SHA,
      }) satisfies ReleaseProvenance

      writeFileSync(
        join(stagedVersionDirectory, `${BUNDLE_NAME}.sha256`),
        `${sha256}  ${BUNDLE_NAME}\n`,
      )
      writeFileSync(
        join(stagedVersionDirectory, "provenance.json"),
        `${JSON.stringify(provenance, null, 2)}\n`,
      )
      writeFileSync(
        join(stagedSiteDirectory, "index.json"),
        `${JSON.stringify([manifest], null, 2)}\n`,
      )

      publishStagedSite(
        {
          siteDirectory,
          stagedSiteDirectory,
          backupDirectory,
        },
        publication,
      )
    } finally {
      rmSync(stagingDirectory, { force: true, recursive: true })
    }
  })
}

function parseCliInput(args: readonly string[]): ReleaseBuildInput {
  const remaining = args.filter((argument) => argument !== "--")
  let version: string | undefined
  let repository: string | undefined

  while (remaining.length > 0) {
    const argument = remaining.shift()
    const value = remaining.shift()

    if (argument === "--version" && value !== undefined) {
      if (version !== undefined) {
        throw new DuplicateCliArgumentError(argument)
      }
      version = value
    } else if (argument === "--repository" && value !== undefined) {
      if (repository !== undefined) {
        throw new DuplicateCliArgumentError(argument)
      }
      repository = value
    } else {
      throw new CliArgumentError(argument ?? "missing argument")
    }
  }

  const { GITHUB_REPOSITORY: environmentRepository } = process.env
  const resolvedRepository = repository ?? environmentRepository
  if (version === undefined || resolvedRepository === undefined) {
    throw new CliArgumentError("--version and --repository or GITHUB_REPOSITORY are required")
  }

  return { repository: resolvedRepository, version, workspace: process.cwd() }
}

if (import.meta.main) {
  Promise.resolve()
    .then(() => buildRelease(parseCliInput(Bun.argv.slice(2))))
    .catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(error.message)
        process.exitCode = 1
        return
      }
      throw error
    })
}
