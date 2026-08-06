import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { ReleaseCoordinates } from "./release-workflow.ts"

const VERSION_DIRECTORY_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const EXPECTED_VERSION_FILES = ["aniliberty.mjs", "aniliberty.mjs.sha256", "provenance.json"]
const manifestSchema = z
  .array(
    z.object({
      code: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      update: z.string(),
      version: z.string(),
    }),
  )
  .length(1)
const provenanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repository: z.string(),
  version: z.string(),
  source: z.literal("src/index.ts"),
  artifact: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  hayaseContract: z.literal("56151c710a9265f42994bd72cff007598c596bab"),
})

export class ReleaseIntegrityError extends Error {
  readonly name = "ReleaseIntegrityError"
}

function exactEntries(directory: string, expected: readonly string[]): void {
  const entries = readdirSync(directory).toSorted()
  if (JSON.stringify(entries) !== JSON.stringify([...expected].toSorted())) {
    throw new ReleaseIntegrityError(`Unexpected release layout at ${directory}`)
  }
  for (const entry of entries) {
    if (!lstatSync(join(directory, entry)).isFile()) {
      throw new ReleaseIntegrityError(`Release artifact must be a regular file: ${entry}`)
    }
  }
}

function verifyVersionDirectory(directory: string, version: string, repository: string): string {
  exactEntries(directory, EXPECTED_VERSION_FILES)
  const bundle = readFileSync(join(directory, "aniliberty.mjs"))
  const sha256 = createHash("sha256").update(bundle).digest("hex")
  const checksum = readFileSync(join(directory, "aniliberty.mjs.sha256"), "utf8")
  if (checksum !== `${sha256}  aniliberty.mjs\n`) {
    throw new ReleaseIntegrityError(`Checksum mismatch for v${version}`)
  }
  const provenance = provenanceSchema.parse(
    JSON.parse(readFileSync(join(directory, "provenance.json"), "utf8")),
  )
  if (
    provenance.repository !== repository ||
    provenance.version !== version ||
    provenance.artifact !== `v${version}/aniliberty.mjs` ||
    provenance.sha256 !== sha256
  ) {
    throw new ReleaseIntegrityError(`Provenance mismatch for v${version}`)
  }
  return sha256
}

export function verifyReleaseSite(input: {
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}): { readonly sha256: string } {
  const site = join(input.workspace, ".release-site")
  const entries = readdirSync(site).toSorted()
  const versions = entries.filter((entry) => VERSION_DIRECTORY_PATTERN.test(entry))
  if (JSON.stringify(entries) !== JSON.stringify(["index.json", ...versions].toSorted())) {
    throw new ReleaseIntegrityError("Pages root contains moving, partial, or unexpected artifacts")
  }
  for (const versionDirectory of versions) {
    if (!lstatSync(join(site, versionDirectory)).isDirectory()) {
      throw new ReleaseIntegrityError(`Release version is not a directory: ${versionDirectory}`)
    }
    verifyVersionDirectory(
      join(site, versionDirectory),
      versionDirectory.slice(1),
      input.coordinates.repository,
    )
  }
  const currentDirectory = join(site, input.coordinates.tag)
  const sha256 = verifyVersionDirectory(
    currentDirectory,
    input.coordinates.version,
    input.coordinates.repository,
  )
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(site, "index.json"), "utf8")),
  )[0]
  const [owner, repositoryName] = input.coordinates.repository.split("/")
  const pagesBase = `https://${owner?.toLowerCase()}.github.io/${encodeURIComponent(repositoryName ?? "")}`
  if (
    manifest?.version !== input.coordinates.version ||
    manifest.sha256 !== sha256 ||
    manifest.update !== `${pagesBase}/index.json` ||
    manifest.code !== `${pagesBase}/${input.coordinates.tag}/aniliberty.mjs`
  ) {
    throw new ReleaseIntegrityError("Stable manifest does not match the immutable release")
  }
  return { sha256 }
}

export function verifyReleasePayloadDirectory(input: {
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}): { readonly sha256: string } {
  const payload = join(input.workspace, "release-payload")
  const sha256 = verifyVersionDirectory(
    payload,
    input.coordinates.version,
    input.coordinates.repository,
  )
  return { sha256 }
}
