import { describe, expect, test } from "bun:test"

import type { HayaseManifestV2 } from "../../src/hayase/types.ts"
import {
  createReleaseManifest,
  InvalidReleaseUrlError,
  InvalidRepositoryError,
  InvalidVersionError,
  parseGitHubRepository,
  parseReleaseUrl,
  parseReleaseVersion,
} from "../../src/release/model.ts"
import type { ExtensionConfig as PinnedExtensionConfig } from "../fixtures/hayase/types-56151c7.d.ts"

const artifact = {
  icon: "data:image/svg+xml;base64,PHN2Zy8+",
  sha256: "0".repeat(64),
}

describe("release model boundaries", () => {
  test("creates the fixed manifest when version and repository are valid", () => {
    // Given: parsed release coordinates
    const version = parseReleaseVersion("1.2.3")
    const repository = parseGitHubRepository("example/aniliberty")

    // When: the release manifest is created
    const manifest = createReleaseManifest(version, repository, artifact)

    // Then: its machine-consumed identity and routing fields are exact
    expect(Object.keys(manifest).toSorted()).toEqual([
      "accuracy",
      "code",
      "deprecated",
      "description",
      "icon",
      "id",
      "languages",
      "manifestVersion",
      "media",
      "name",
      "sha256",
      "type",
      "update",
      "updatePeers",
      "url",
      "version",
    ])
    expect(manifest.manifestVersion).toBe(2)
    expect(manifest.deprecated).toBeFalse()
    expect(manifest.name).toBe("AniLiberty")
    expect(String(manifest.version)).toBe("1.2.3")
    expect(manifest.description).toBe("Unofficial AniLiberty Russian-dub torrent source")
    expect(manifest.id).toBe("aniliberty.torrents")
    expect(manifest.type).toBe("torrent")
    expect(manifest.accuracy).toBe("medium")
    expect(manifest.media).toBe("dub")
    expect(manifest.icon).toBe(artifact.icon)
    expect(manifest.sha256).toBe(artifact.sha256)
    expect(manifest.url).toBe("aHR0cHM6Ly9hbmlsaWJlcnR5LnRvcA==")
    expect(manifest.languages).toEqual(["RU"])
    expect(String(manifest.update)).toBe("https://example.github.io/aniliberty/index.json")
    expect(String(manifest.code)).toBe("https://example.github.io/aniliberty/v1.2.3/aniliberty.mjs")
    expect(manifest.updatePeers).toBeFalse()
  })

  test("accepts a strict semantic version with prerelease metadata", () => {
    // Given: a release-candidate semantic version
    const rawVersion = "0.0.0-test.1"

    // When: the version crosses the model boundary
    const version = parseReleaseVersion(rawVersion)

    // Then: the exact version remains available for immutable paths
    expect(String(version)).toBe(rawVersion)
  })

  test("is directly compatible with local and pinned Hayase manifests", () => {
    // Given: a generated release manifest
    const manifest = createReleaseManifest(
      parseReleaseVersion("1.2.3"),
      parseGitHubRepository("example/aniliberty"),
      artifact,
    )

    // When: it is assigned through both consumed Hayase contracts
    const localManifest: HayaseManifestV2 = manifest
    const pinnedManifest: PinnedExtensionConfig = manifest
    localManifest.languages.push("RU")

    // Then: the supported-language array is mutable and retains its literal values
    expect(pinnedManifest.languages).toEqual(["RU", "RU"])
  })

  test("rejects an incomplete semantic version", () => {
    // Given: a version missing its patch component
    const rawVersion = "1.2"

    // When: the version crosses the model boundary
    const parse = () => parseReleaseVersion(rawVersion)

    // Then: validation fails with the typed version error
    expect(parse).toThrow(InvalidVersionError)
  })

  test("rejects an empty repository", () => {
    // Given: an empty repository argument
    const rawRepository = ""

    // When: the repository crosses the model boundary
    const parse = () => parseGitHubRepository(rawRepository)

    // Then: validation fails with the typed repository error
    expect(parse).toThrow(InvalidRepositoryError)
  })

  test.each(["owner", "owner/repo/extra", "owner/.git", "-owner/repo", "owner/repo name"])(
    "rejects malformed repository %s",
    (rawRepository) => {
      // Given: a repository that is not a safe GitHub owner/repo path
      // When: the repository crosses the model boundary
      const parse = () => parseGitHubRepository(rawRepository)

      // Then: validation fails with the typed repository error
      expect(parse).toThrow(InvalidRepositoryError)
    },
  )

  test.each(["owner/repo", "your-username/aniliberty", "<owner>/aniliberty"])(
    "rejects placeholder repository %s",
    (rawRepository) => {
      // Given: a syntactically plausible placeholder repository
      // When: the repository crosses the model boundary
      const parse = () => parseGitHubRepository(rawRepository)

      // Then: validation fails with the typed repository error
      expect(parse).toThrow(InvalidRepositoryError)
    },
  )

  test.each([
    "https://raw.githubusercontent.com/example/aniliberty/main/aniliberty.mjs",
    "https://github.com/example/aniliberty/blob/master/aniliberty.mjs",
    "https://github.com/example/aniliberty/blob/develop/aniliberty.mjs",
    "https://github.com/example/aniliberty/tree/release/aniliberty.mjs",
    "https://example.github.io/aniliberty/refs/heads/main/aniliberty.mjs",
  ])("rejects moving-branch release URL %s", (rawUrl) => {
    // Given: an artifact URL tied to a moving branch
    // When: the URL crosses the release boundary
    const parse = () => parseReleaseUrl(rawUrl)

    // Then: validation fails with the typed URL error
    expect(parse).toThrow(InvalidReleaseUrlError)
  })
})
