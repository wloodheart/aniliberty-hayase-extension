import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { ReleaseCoordinates } from "./release-workflow.ts"
import { parseUniqueJson } from "./strict-json.ts"

const VERSION_DIRECTORY_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const EXPECTED_VERSION_FILES = ["aniliberty.mjs", "aniliberty.mjs.sha256", "provenance.json"]
const strictVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const iconPrefix = "data:image/svg+xml;base64,"
const iconSchema = z
  .string()
  .regex(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/)
  .refine((value) =>
    Buffer.from(value.slice(iconPrefix.length), "base64")
      .toString("utf8")
      .trimStart()
      .startsWith("<svg"),
  )
const manifestSchema = z
  .array(
    z.strictObject({
      manifestVersion: z.literal(2),
      deprecated: z.literal(false),
      name: z.literal("AniLiberty"),
      version: strictVersionSchema,
      description: z.literal("Unofficial AniLiberty Russian-dub torrent source"),
      id: z.literal("aniliberty.torrents"),
      type: z.literal("torrent"),
      accuracy: z.literal("medium"),
      icon: iconSchema,
      media: z.literal("dub"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      url: z.literal("aHR0cHM6Ly9hbmlsaWJlcnR5LnRvcA=="),
      languages: z.tuple([z.literal("RU")]),
      update: z.url(),
      code: z.url(),
      updatePeers: z.literal(false),
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
    const artifact = lstatSync(join(directory, entry))
    if (!artifact.isFile() || artifact.nlink !== 1) {
      throw new ReleaseIntegrityError(`Release artifact must be a regular file: ${entry}`)
    }
  }
}

function verifyDirectory(path: string, label: string): void {
  if (!lstatSync(path).isDirectory()) {
    throw new ReleaseIntegrityError(`Release directory must not be linked: ${label}`)
  }
}

export function verifyImmutableVersionDirectory(input: {
  readonly directory: string
  readonly repository: string
  readonly version: string
}): string {
  verifyDirectory(input.directory, `v${input.version}`)
  exactEntries(input.directory, EXPECTED_VERSION_FILES)
  const bundle = readFileSync(join(input.directory, "aniliberty.mjs"))
  const sha256 = createHash("sha256").update(bundle).digest("hex")
  const checksum = readFileSync(join(input.directory, "aniliberty.mjs.sha256"), "utf8")
  if (checksum !== `${sha256}  aniliberty.mjs\n`) {
    throw new ReleaseIntegrityError(`Checksum mismatch for v${input.version}`)
  }
  const provenance = provenanceSchema.parse(
    parseUniqueJson(readFileSync(join(input.directory, "provenance.json"), "utf8")),
  )
  if (
    provenance.repository !== input.repository ||
    provenance.version !== input.version ||
    provenance.artifact !== `v${input.version}/aniliberty.mjs` ||
    provenance.sha256 !== sha256
  ) {
    throw new ReleaseIntegrityError(`Provenance mismatch for v${input.version}`)
  }
  return sha256
}

export function verifyReleaseSite(input: {
  readonly coordinates: ReleaseCoordinates
  readonly workspace: string
}): { readonly sha256: string } {
  const site = join(input.workspace, ".release-site")
  verifyDirectory(site, ".release-site")
  const entries = readdirSync(site).toSorted()
  const versions = entries.filter((entry) => VERSION_DIRECTORY_PATTERN.test(entry))
  if (JSON.stringify(entries) !== JSON.stringify(["index.json", ...versions].toSorted())) {
    throw new ReleaseIntegrityError("Pages root contains moving, partial, or unexpected artifacts")
  }
  const indexPath = join(site, "index.json")
  const indexArtifact = lstatSync(indexPath)
  if (!indexArtifact.isFile() || indexArtifact.nlink !== 1) {
    throw new ReleaseIntegrityError("Stable manifest must be one regular file")
  }
  for (const versionDirectory of versions) {
    verifyImmutableVersionDirectory({
      directory: join(site, versionDirectory),
      repository: input.coordinates.repository,
      version: versionDirectory.slice(1),
    })
  }
  const currentDirectory = join(site, input.coordinates.tag)
  const sha256 = verifyImmutableVersionDirectory({
    directory: currentDirectory,
    repository: input.coordinates.repository,
    version: input.coordinates.version,
  })
  const manifest = manifestSchema.parse(parseUniqueJson(readFileSync(indexPath, "utf8")))[0]
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
  const sha256 = verifyImmutableVersionDirectory({
    directory: payload,
    repository: input.coordinates.repository,
    version: input.coordinates.version,
  })
  return { sha256 }
}
