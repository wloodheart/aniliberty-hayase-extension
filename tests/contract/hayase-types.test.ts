import { expect, test } from "bun:test"
import type {
  AnimeQueryWithFetch,
  HayaseManifestV2,
  SearchOptionValues,
  TorrentResult,
  TorrentSource,
} from "../../src/hayase/types.ts"
import type {
  ExtensionConfig as PinnedExtensionConfig,
  TorrentSource as PinnedTorrentSource,
} from "../fixtures/hayase/types-56151c7.d.ts"

type IsAssignable<From, To> = [From] extends [To] ? true : false

const localManifestTypeIsPinnedCompatible: IsAssignable<HayaseManifestV2, PinnedExtensionConfig> =
  true
const localSourceTypeIsPinnedCompatible: IsAssignable<TorrentSource, PinnedTorrentSource> = true

const manifest = {
  manifestVersion: 2,
  deprecated: false,
  name: "Contract source",
  version: "1.0.0",
  description: "Pinned compatibility probe",
  id: "contract-source",
  type: "torrent",
  accuracy: "high",
  ratio: "perma",
  icon: "https://example.com/icon.png",
  media: "both",
  url: "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
  languages: ["ALL"],
  code: "gh:example/contract-source/dist/index",
  options: {
    quality: {
      type: "select",
      description: "Preferred quality",
      values: ["1080", "720"],
      default: "1080",
    },
  },
  updatePeers: false,
  rateLimit: 1,
} satisfies HayaseManifestV2

const pinnedManifest: PinnedExtensionConfig = manifest

const torrent: TorrentResult = {
  title: "Example",
  link: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
  seeders: 1,
  leechers: 0,
  downloads: 2,
  accuracy: "high",
  hash: "0123456789012345678901234567890123456789",
  size: 1,
  date: new Date(0),
}

const query = {
  media: {},
  anilistId: 1,
  titles: ["Example"],
  episode: 1,
  resolution: "1080",
  exclusions: [],
  fetch,
} satisfies AnimeQueryWithFetch

const source = {
  test: async () => true,
  single: async () => [torrent],
  batch: async () => [torrent],
  movie: async () => [torrent],
} satisfies TorrentSource

const pinnedSource: PinnedTorrentSource = source

test("accepts CORS URL and manifest option definitions without an update URL", () => {
  // Given: one concrete manifest bound to local and pinned declarations
  // When: its consumed optional fields are read
  // Then: the CORS URL and manifest option metadata retain their runtime shape
  expect(pinnedManifest.url).toBe(manifest.url)
  expect(manifest.options.quality.default).toBe("1080")
  expect(localManifestTypeIsPinnedCompatible).toBe(true)
})

test("assigns local sources to the pinned runtime contract with mutable arrays", async () => {
  // Given: scalar runtime option values and a source accepted by the pinned contract
  const options: SearchOptionValues = { quality: "1080", limit: 10, trusted: true }

  // When: the runtime invokes the local source and appends a sanitized result
  const results = await pinnedSource.single(query, options)
  results.push(torrent)

  // Then: all source methods are present and the result array is mutable
  expect(Object.keys(source).toSorted()).toEqual(["batch", "movie", "single", "test"])
  expect(results).toHaveLength(2)
  expect(localSourceTypeIsPinnedCompatible).toBe(true)
})
