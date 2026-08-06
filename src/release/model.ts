import { z } from "zod"

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/
const PLACEHOLDER_PATTERN =
  /^(?:owner|repo|repository|username|your[-_ ]?(?:owner|repo|repository|username))$/i
const MOVING_URL_PATTERN =
  /raw\.githubusercontent\.com|\/refs\/heads\/|github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+(?:\/|$)/i

const ReleaseVersionSchema = z.string().regex(SEMVER_PATTERN).brand<"ReleaseVersion">()
const ReleaseUrlSchema = z
  .url()
  .refine((value) => !MOVING_URL_PATTERN.test(value))
  .brand<"ReleaseUrl">()

export type ReleaseVersion = z.infer<typeof ReleaseVersionSchema>
export type ReleaseUrl = z.infer<typeof ReleaseUrlSchema>

export type GitHubRepository = {
  readonly owner: string
  readonly name: string
  readonly slug: string
}

export type ReleaseManifestArtifact = {
  readonly icon: string
  readonly sha256: string
}

export type ReleaseManifest = {
  readonly manifestVersion: 2
  readonly deprecated: false
  readonly name: "AniLiberty"
  readonly version: ReleaseVersion
  readonly description: "Unofficial AniLiberty Russian-dub torrent source"
  readonly id: "aniliberty.torrents"
  readonly type: "torrent"
  readonly accuracy: "medium"
  readonly icon: string
  readonly media: "dub"
  readonly sha256: string
  readonly url: "aHR0cHM6Ly9hbmlsaWJlcnR5LnRvcA=="
  readonly languages: "RU"[]
  readonly update: ReleaseUrl
  readonly code: ReleaseUrl
  readonly updatePeers: false
}

export class InvalidVersionError extends Error {
  readonly name = "InvalidVersionError"

  constructor(readonly value: string) {
    super(`Release version must be strict semver: ${value}`)
  }
}

export class InvalidRepositoryError extends Error {
  readonly name = "InvalidRepositoryError"

  constructor(readonly value: string) {
    super(`Repository must be a non-placeholder GitHub owner/repo path: ${value}`)
  }
}

export class InvalidReleaseUrlError extends Error {
  readonly name = "InvalidReleaseUrlError"

  constructor(readonly value: string) {
    super(`Release URL must be an absolute immutable or stable URL: ${value}`)
  }
}

export function parseReleaseVersion(value: string): ReleaseVersion {
  const result = ReleaseVersionSchema.safeParse(value)
  if (!result.success) {
    throw new InvalidVersionError(value)
  }
  return result.data
}

export function parseGitHubRepository(value: string): GitHubRepository {
  const separator = value.indexOf("/")
  const owner = value.slice(0, separator)
  const name = value.slice(separator + 1)
  const isValid =
    separator > 0 &&
    separator === value.lastIndexOf("/") &&
    OWNER_PATTERN.test(owner) &&
    REPOSITORY_NAME_PATTERN.test(name) &&
    !owner.includes("--") &&
    !PLACEHOLDER_PATTERN.test(owner) &&
    !PLACEHOLDER_PATTERN.test(name)

  if (!isValid) {
    throw new InvalidRepositoryError(value)
  }

  return Object.freeze({ owner, name, slug: value })
}

export function parseReleaseUrl(value: string): ReleaseUrl {
  const result = ReleaseUrlSchema.safeParse(value)
  if (!result.success) {
    throw new InvalidReleaseUrlError(value)
  }
  return result.data
}

export function createReleaseManifest(
  version: ReleaseVersion,
  repository: GitHubRepository,
  artifact: ReleaseManifestArtifact,
): ReleaseManifest {
  const pagesBase = `https://${repository.owner.toLowerCase()}.github.io/${encodeURIComponent(repository.name)}`
  const languages: "RU"[] = ["RU"]

  return Object.freeze({
    manifestVersion: 2,
    deprecated: false,
    name: "AniLiberty",
    version,
    description: "Unofficial AniLiberty Russian-dub torrent source",
    id: "aniliberty.torrents",
    type: "torrent",
    accuracy: "medium",
    icon: artifact.icon,
    media: "dub",
    sha256: artifact.sha256,
    url: "aHR0cHM6Ly9hbmlsaWJlcnR5LnRvcA==",
    languages,
    update: parseReleaseUrl(`${pagesBase}/index.json`),
    code: parseReleaseUrl(`${pagesBase}/v${version}/aniliberty.mjs`),
    updatePeers: false,
  })
}
