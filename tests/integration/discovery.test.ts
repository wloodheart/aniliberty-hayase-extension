import { expect, test } from "bun:test"

import type { SearchRelease, Torrent } from "../../src/aniliberty/schemas.ts"
import {
  type DiscoveryClient,
  type DiscoveryRequest,
  DiscoveryService,
} from "../../src/discovery/discover.ts"
import {
  baseDiscoveryRequest,
  differentHashTorrent,
  releaseWith,
  seasonOneRelease,
  seasonOneTorrent,
  seasonTwoRelease,
  seasonTwoTorrent,
  torrentWith,
} from "../helpers/discovery-fixtures.ts"

type SeasonCase = readonly [string, DiscoveryRequest, SearchRelease, Torrent]
type EmptyCase = readonly [string, readonly SearchRelease[], number]

class ImmediateClient implements DiscoveryClient {
  searches = 0
  torrentRequests = 0

  constructor(
    private readonly releases: readonly SearchRelease[],
    private readonly torrents: readonly unknown[],
  ) {}

  searchReleases(): Promise<readonly SearchRelease[]> {
    this.searches += 1
    return Promise.resolve(this.releases)
  }

  releaseTorrents(): Promise<readonly unknown[]> {
    this.torrentRequests += 1
    return Promise.resolve(this.torrents)
  }
}

test("caps concurrent title fan-out at three and coalesces single and batch discovery", async () => {
  // Given: three selected titles held behind deterministic search and torrent barriers
  const searchesStarted = Promise.withResolvers<void>()
  const releaseSearches = Promise.withResolvers<void>()
  const torrentStarted = Promise.withResolvers<void>()
  const releaseTorrents = Promise.withResolvers<void>()
  let activeSearches = 0
  let maximumSearches = 0
  let searchCalls = 0
  let torrentCalls = 0
  const hevc720 = torrentWith(differentHashTorrent(seasonOneTorrent), {
    codec: seasonTwoTorrent.codec,
    label: "Synthetic S1 pack [720p][HEVC][1-12]",
    quality: { value: "720p" },
  })
  const client: DiscoveryClient = {
    searchReleases: async () => {
      searchCalls += 1
      activeSearches += 1
      maximumSearches = Math.max(maximumSearches, activeSearches)
      if (searchCalls === 3) searchesStarted.resolve()
      await releaseSearches.promise
      activeSearches -= 1
      return [seasonOneRelease]
    },
    releaseTorrents: async () => {
      torrentCalls += 1
      torrentStarted.resolve()
      await releaseTorrents.promise
      return [seasonOneTorrent, hevc720]
    },
  }
  const service = new DiscoveryService(client, () => 0)
  const shared = {
    ...baseDiscoveryRequest,
    titles: ["Hell Mode", "Hell Mode Anime", "Infernal Mode", "Fourth Ignored Title"],
  }

  // When: single and batch callers use different filters for the same media concurrently
  const single = service.discover({ ...shared, exclusions: ["hevc"], mode: "single" })
  const batch = service.discover({
    ...shared,
    exclusions: ["avc"],
    mode: "batch",
    resolution: "720",
  })
  await searchesStarted.promise
  releaseSearches.resolve()
  await torrentStarted.promise
  releaseTorrents.resolve()
  const [singleResults, batchResults] = await Promise.all([single, batch])

  // Then: one bounded unfiltered operation feeds independent per-caller filters
  expect(searchCalls).toBe(3)
  expect(maximumSearches).toBe(3)
  expect(torrentCalls).toBe(1)
  expect(singleResults.map(({ torrent }) => torrent.hash)).toEqual([seasonOneTorrent.hash])
  expect(batchResults.map(({ torrent }) => torrent.hash)).toEqual([hevc720.hash])
})

test("deduplicates releases exactly by branded ID before matching", async () => {
  // Given: the same branded release returned for every selected title
  const client = new ImmediateClient([seasonOneRelease, seasonOneRelease], [seasonOneTorrent])
  const service = new DiscoveryService(client, () => 0)
  const request = {
    ...baseDiscoveryRequest,
    titles: ["Hell Mode", "Hell Mode Anime", "Infernal Mode"],
  }

  // When: discovery merges the search responses
  const results = await service.discover(request)

  // Then: duplicate IDs do not create an ambiguous tie or duplicate fetch
  expect(results).toHaveLength(1)
  expect(client.searches).toBe(3)
  expect(client.torrentRequests).toBe(1)
})

const seasonCases = [
  ["season one", baseDiscoveryRequest, seasonOneRelease, seasonOneTorrent],
  [
    "season two",
    {
      ...baseDiscoveryRequest,
      titles: ["Hell Mode 2nd Season"],
      matchingTitles: ["Hell Mode 2nd Season"],
      episode: 5,
      episodeCount: null,
    },
    seasonTwoRelease,
    seasonTwoTorrent,
  ],
] satisfies readonly SeasonCase[]

test.each(seasonCases)(
  "selects the reduced %s release and torrents",
  async (_label, request, release, torrent) => {
    // Given: both reduced season search candidates
    const state = { searches: 0, torrentRequests: 0 }
    const client: DiscoveryClient = {
      searchReleases: () => Promise.resolve([seasonOneRelease, seasonTwoRelease]),
      releaseTorrents: (releaseId) => {
        state.torrentRequests += 1
        return Promise.resolve(releaseId === release.id ? [torrent] : [])
      },
    }

    // When: the season-specific request is discovered
    const results = await new DiscoveryService(client, () => 0).discover(request)

    // Then: only that season's release is fetched and returned
    expect(results.map(({ release: found }) => found.id)).toEqual([release.id])
    expect(results.map(({ torrent: found }) => found.hash)).toEqual([torrent.hash])
    expect(state.torrentRequests).toBe(1)
  },
)

const emptyCases = [
  ["blocked", [releaseWith(seasonOneRelease, { is_blocked_by_geo: true })], 0],
  ["ambiguous", [seasonOneRelease, { ...seasonOneRelease, id: seasonTwoRelease.id }], 0],
  ["no torrent", [seasonOneRelease], 1],
] satisfies readonly EmptyCase[]

test.each(emptyCases)(
  "returns no results for %s discovery",
  async (_label, releases, expectedFetches) => {
    // Given: a release outcome that cannot produce a torrent result
    const client = new ImmediateClient(releases, [])
    const service = new DiscoveryService(client, () => 0)

    // When: discovery runs
    const results = await service.discover(baseDiscoveryRequest)

    // Then: no result is returned and torrents are fetched only after a unique winner
    expect(results).toEqual([])
    expect(client.torrentRequests).toBe(expectedFetches)
  },
)

test("returns empty results when every torrent is excluded or lacks coverage", async () => {
  // Given: one excluded torrent and one torrent with no primary range
  const noRange = torrentWith(differentHashTorrent(seasonOneTorrent), { description: "OVA [1-4]" })
  const client = new ImmediateClient([seasonOneRelease], [seasonOneTorrent, noRange])
  const service = new DiscoveryService(client, () => 0)

  // When: filtering excludes AVC and requires single coverage
  const results = await service.discover({ ...baseDiscoveryRequest, exclusions: ["avc"] })

  // Then: all-excluded and no-range paths remain ordinary empty results
  expect(results).toEqual([])
  expect(client.torrentRequests).toBe(1)
})

test("does not cache a failed discovery promise", async () => {
  // Given: a client whose first search rejects and second succeeds
  let searches = 0
  const client: DiscoveryClient = {
    searchReleases: () => {
      searches += 1
      return searches === 1
        ? Promise.reject(new TypeError("synthetic transient failure"))
        : Promise.resolve([seasonOneRelease])
    },
    releaseTorrents: () => Promise.resolve([seasonOneTorrent]),
  }
  const service = new DiscoveryService(client, () => 0)

  // When: the same request is retried after failure
  const failedWithTypeError = await service.discover(baseDiscoveryRequest).then(
    () => false,
    (error: unknown) => error instanceof TypeError,
  )
  expect(failedWithTypeError).toBe(true)
  const results = await service.discover(baseDiscoveryRequest)

  // Then: the second request performs a fresh search and succeeds
  expect(results).toHaveLength(1)
  expect(searches).toBe(2)
})
