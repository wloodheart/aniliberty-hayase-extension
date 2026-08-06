import { afterEach, expect, test } from "bun:test"

import { InfoHashSchema } from "../../src/aniliberty/schemas.ts"
import { HayaseTorrentSource } from "../../src/hayase/adapter.ts"
import type { AnimeQueryWithFetch, InjectedFetch } from "../../src/hayase/types.ts"
import { seasonOneRelease, seasonOneTorrent, torrentWith } from "../helpers/discovery-fixtures.ts"

const originalFetch = globalThis.fetch

class ForbiddenGlobalFetchError extends Error {
  readonly name = "ForbiddenGlobalFetchError"
}

function installGlobalSabotage(): void {
  globalThis.fetch = Object.assign(
    () => Promise.reject(new ForbiddenGlobalFetchError("Global fetch used by search")),
    { preconnect: originalFetch.preconnect },
  )
}

function media(id: number, title: string, format: "MOVIE" | "TV"): unknown {
  return {
    id,
    title: { userPreferred: title, english: null, romaji: null, native: null },
    startDate: { year: 2026 },
    episodes: format === "MOVIE" ? 1 : 12,
    format,
  }
}

function query(fetch: InjectedFetch, mediaValue: unknown, episode = 6): AnimeQueryWithFetch {
  return {
    media: mediaValue,
    anilistId: 1,
    titles: ["Hell Mode"],
    episode,
    resolution: "1080",
    exclusions: [],
    fetch,
  }
}

const movieRelease = {
  ...seasonOneRelease,
  id: 20096,
  type: { value: "Movie" },
  name: { main: "Synthetic Movie", english: "Synthetic Movie", alternative: null },
  episodes_total: 1,
}
const infernalRelease = {
  ...seasonOneRelease,
  name: { main: "Infernal Mode", english: "Infernal Mode", alternative: null },
}
const movieTorrent = torrentWith(seasonOneTorrent, {
  id: 32001,
  hash: InfoHashSchema.parse("2222222222222222222222222222222222222222"),
  label: "Synthetic Movie [1080p][AVC]",
  magnet: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222&dn=synthetic-movie",
  description: "Movie",
})

class RoutingFetch {
  calls = 0
  searches = 0
  torrents = 0

  readonly fetch: InjectedFetch = (input) => {
    this.calls += 1
    const url = new URL(input.toString())
    if (url.pathname.endsWith("/app/search/releases")) {
      this.searches += 1
      const searchTitle = url.searchParams.get("query")
      const releases =
        searchTitle === "Synthetic Movie"
          ? [movieRelease]
          : searchTitle === "Infernal Mode"
            ? [infernalRelease]
            : [seasonOneRelease]
      return Promise.resolve(Response.json(releases))
    }
    if (url.pathname.endsWith("/anime/torrents/release/20096")) {
      this.torrents += 1
      return Promise.resolve(Response.json([movieTorrent]))
    }
    if (url.pathname.endsWith("/anime/torrents/release/10096")) {
      this.torrents += 1
      return Promise.resolve(Response.json([seasonOneTorrent]))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("routes single batch and movie through injected fetch while coalescing series work", async () => {
  // Given: global fetch sabotage and one injected router for series and movie fixtures
  installGlobalSabotage()
  const router = new RoutingFetch()
  const adapter = new HayaseTorrentSource()
  const seriesQuery = query(router.fetch, media(1, "Hell Mode", "TV"))
  const movieQuery = {
    ...query(router.fetch, media(2, "Synthetic Movie", "MOVIE"), 1),
    anilistId: 2,
    titles: ["Synthetic Movie"],
  }

  // When: all three Hayase modes search concurrently
  const [single, batch, movieResults] = await Promise.all([
    adapter.single(seriesQuery),
    adapter.batch(seriesQuery),
    adapter.movie(movieQuery),
  ])

  // Then: same-media series calls share work and movie keeps its distinct mode
  expect(single.map(({ type }) => type)).toEqual(["batch"])
  expect(batch.map(({ type }) => type)).toEqual(["batch"])
  expect(movieResults.map(({ type }) => type)).toEqual([undefined])
  expect(router.calls).toBe(4)
  expect(router.searches).toBe(2)
  expect(router.torrents).toBe(2)
})

test("isolates cached network values between different injected fetch identities", async () => {
  // Given: two transport identities serving the same media and cache key
  installGlobalSabotage()
  const firstRouter = new RoutingFetch()
  const secondRouter = new RoutingFetch()
  const adapter = new HayaseTorrentSource()

  // When: identical discovery runs once through each fetch identity
  const first = await adapter.single(query(firstRouter.fetch, media(1, "Hell Mode", "TV")))
  const second = await adapter.single(query(secondRouter.fetch, media(1, "Hell Mode", "TV")))

  // Then: neither fetch identity receives network-backed cache values from the other
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(firstRouter.calls).toBe(2)
  expect(secondRouter.calls).toBe(2)
})

type CacheVariant = readonly [string, (base: AnimeQueryWithFetch) => AnimeQueryWithFetch]

const cacheVariants = [
  ["trusted titles", (base) => ({ ...base, titles: ["Infernal Mode"] })],
  ["supplied episode count", (base) => ({ ...base, episodeCount: 24 })],
] satisfies readonly CacheVariant[]

test.each(cacheVariants)("separates same-fetch cache entries by %s", async (_label, vary) => {
  // Given: one media identity with two distinct trusted query inputs
  installGlobalSabotage()
  const router = new RoutingFetch()
  const adapter = new HayaseTorrentSource()
  const firstQuery = { ...query(router.fetch, media(1, "Hell Mode", "TV")), episodeCount: 12 }
  const secondQuery = vary(firstQuery)

  // When: each query variant is discovered
  const first = await adapter.single(firstQuery)
  const second = await adapter.single(secondQuery)

  // Then: each trusted input creates a separate discovery/cache load
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(router.searches).toBe(2)
  expect(router.torrents).toBe(2)
})
