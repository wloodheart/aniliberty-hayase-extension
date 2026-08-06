import { afterEach, expect, test } from "bun:test"

import { HayaseTorrentSource } from "../../src/hayase/adapter.ts"
import type { AnimeQueryWithFetch, InjectedFetch } from "../../src/hayase/types.ts"
import { seasonOneRelease, seasonOneTorrent } from "../helpers/discovery-fixtures.ts"

const originalFetch = globalThis.fetch
const originalDate = globalThis.Date
const unsafeContext = "Hell Mode https://outside.example raw payload"

class MissingAdapterError extends Error {
  readonly name = "MissingAdapterError"
}

function installGlobalFetch(fetch: InjectedFetch): void {
  globalThis.fetch = Object.assign(fetch, { preconnect: originalFetch.preconnect })
}

function jsonResponse(value: unknown): Response {
  return Response.json(value)
}

function media(id = 1): unknown {
  return {
    id,
    title: {
      userPreferred: "Hell Mode",
      english: "Hell Mode",
      romaji: "Hell Mode: Yarikomizuki no Gamer wa Hai Settei no Isekai de Musou suru",
      native: "ヘルモード",
    },
    startDate: { year: 2026 },
    episodes: 12,
    format: "TV",
  }
}

function query(fetch: InjectedFetch, mediaValue: unknown = media()): AnimeQueryWithFetch {
  return {
    media: mediaValue,
    anilistId: 1,
    titles: ["Hell Mode"],
    episode: 6,
    episodeCount: 12,
    resolution: "1080",
    exclusions: [],
    fetch,
  }
}

async function captureError(action: Promise<unknown>): Promise<Error> {
  try {
    await action
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new MissingAdapterError("Expected adapter failure")
}

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.Date = originalDate
})

test("returns true only when the parsed health status is alive", async () => {
  // Given: two valid status responses with opposite liveness values
  const adapter = new HayaseTorrentSource()

  // When: health is checked for each status
  installGlobalFetch(() =>
    Promise.resolve(jsonResponse({ is_alive: true, available_api_endpoints: [] })),
  )
  const alive = await adapter.test()
  installGlobalFetch(() =>
    Promise.resolve(jsonResponse({ is_alive: false, available_api_endpoints: [] })),
  )
  const unavailable = await adapter.test()

  // Then: only the alive response succeeds
  expect(alive).toBe(true)
  expect(unavailable).toBe(false)
})

test("bounds health failure and exposes only a stable sanitized error", async () => {
  // Given: a health transport that settles only when the client deadline aborts it
  const adapter = new HayaseTorrentSource()
  installGlobalFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!(signal instanceof AbortSignal)) {
          reject(new MissingAdapterError("Health request omitted its deadline signal"))
          return
        }
        signal.addEventListener(
          "abort",
          () => reject(new DOMException(unsafeContext, "AbortError")),
          { once: true },
        )
      }),
  )
  const startedAt = performance.now()

  // When: health reaches its operational deadline
  const error = await captureError(adapter.test())
  const elapsedMilliseconds = performance.now() - startedAt

  // Then: it settles inside Hayase's allowance without exposing infrastructure context
  expect(elapsedMilliseconds).toBeLessThanOrEqual(3500)
  expect(error.name).toBe("TorrentSourceUnavailableError")
  expect(error.message).toBe("AniLiberty is unavailable")
  expect(JSON.stringify(error)).not.toContain(unsafeContext)
})

test("maps discovered torrents exactly into mutable Hayase results", async () => {
  // Given: reduced AniLiberty responses reached through the query transport
  const injectedFetch: InjectedFetch = (input) => {
    const path = new URL(input.toString()).pathname
    if (path.endsWith("/app/search/releases"))
      return Promise.resolve(jsonResponse([seasonOneRelease]))
    if (path.endsWith("/anime/torrents/release/10096")) {
      return Promise.resolve(jsonResponse([seasonOneTorrent]))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  }
  const adapter = new HayaseTorrentSource()

  // When: a single-episode query discovers a season pack
  const results = await adapter.single(query(injectedFetch))

  // Then: AniLiberty values are preserved in a mutable Worker-compatible shape
  expect(results).toEqual([
    {
      title: seasonOneTorrent.label,
      link: seasonOneTorrent.magnet,
      id: seasonOneTorrent.id,
      seeders: seasonOneTorrent.seeders,
      leechers: seasonOneTorrent.leechers,
      downloads: seasonOneTorrent.completed_times,
      accuracy: "medium",
      hash: seasonOneTorrent.hash,
      size: seasonOneTorrent.size,
      date: new Date(seasonOneTorrent.created_at),
      type: "batch",
    },
  ])
  const first = results[0]
  if (first === undefined) throw new MissingAdapterError("Expected one mapped result")
  results.push({ ...first })
  expect(Reflect.set(first, "title", "Mutable title")).toBe(true)
  expect(results).toHaveLength(2)
  expect(first.title).toBe("Mutable title")
})

test("fails closed for invalid media and ordinary no-match discovery", async () => {
  // Given: one malformed media payload and one valid query with no release match
  let requests = 0
  const injectedFetch: InjectedFetch = () => {
    requests += 1
    return Promise.resolve(jsonResponse([]))
  }
  const adapter = new HayaseTorrentSource()

  // When: both ordinary empty-result paths are searched
  const invalid = await adapter.single(query(injectedFetch, { id: unsafeContext }))
  const noMatch = await adapter.single(query(injectedFetch))

  // Then: neither path becomes an infrastructure exception
  expect(invalid).toEqual([])
  expect(noMatch).toEqual([])
  expect(requests).toBe(1)
})

test("discovers from Hayase synonyms when parsed media titles are non-Latin", async () => {
  // Given: valid media with only non-Latin titles and a trusted Latin Hayase synonym
  let requests = 0
  const injectedFetch: InjectedFetch = (input) => {
    requests += 1
    const path = new URL(input.toString()).pathname
    return Promise.resolve(
      path.endsWith("/app/search/releases")
        ? jsonResponse([seasonOneRelease])
        : jsonResponse([seasonOneTorrent]),
    )
  }
  const nonLatinMedia = {
    id: 1,
    title: {
      userPreferred: "ヘルモード",
      english: null,
      romaji: "ヘルモード",
      native: "ヘルモード",
    },
    startDate: { year: 2026 },
    episodes: 12,
    format: "TV",
  }
  const adapter = new HayaseTorrentSource()

  // When: discovery receives the trusted synonym through query.titles
  const results = await adapter.single(query(injectedFetch, nonLatinMedia))

  // Then: the synonym reaches search and produces the expected torrent
  expect(results).toHaveLength(1)
  expect(requests).toBe(2)
})

test.each([
  [2, media(1)],
  [1, media(2)],
])(
  "fails closed when query AniList ID %i differs from parsed media",
  async (anilistId, mediaValue) => {
    // Given: trusted and parsed AniList IDs that disagree in either direction
    let requests = 0
    const injectedFetch: InjectedFetch = () => {
      requests += 1
      return Promise.resolve(jsonResponse([]))
    }
    const mismatchedQuery = { ...query(injectedFetch, mediaValue), anilistId }

    // When: identity consistency is checked before discovery
    const results = await new HayaseTorrentSource().single(mismatchedQuery)

    // Then: no cache or network boundary is reached
    expect(results).toEqual([])
    expect(requests).toBe(0)
  },
)

function expectSanitized(error: Error): void {
  expect(error.name).toBe("TorrentSourceUnavailableError")
  expect(error.message).toBe("AniLiberty is unavailable")
  expect(error.stack).not.toContain(unsafeContext)
  expect(JSON.stringify(error)).not.toContain(unsafeContext)
  expect(error.cause).toBeUndefined()
}

const harmlessFetch: InjectedFetch = () => Promise.resolve(jsonResponse([]))
const baseHostileQuery = query(harmlessFetch)
const hostileQueries = [
  {
    ...baseHostileQuery,
    get media(): unknown {
      throw new MissingAdapterError(unsafeContext)
    },
  },
  {
    ...baseHostileQuery,
    get fetch(): InjectedFetch {
      throw new MissingAdapterError(unsafeContext)
    },
  },
  {
    ...baseHostileQuery,
    get titles(): readonly string[] {
      throw new MissingAdapterError(unsafeContext)
    },
  },
  {
    ...baseHostileQuery,
    get exclusions(): readonly string[] {
      throw new MissingAdapterError(unsafeContext)
    },
  },
] satisfies readonly AnimeQueryWithFetch[]

test.each(hostileQueries)("sanitizes unexpected query getter failures", async (hostileQuery) => {
  // Given: a contract-shaped query whose boundary getter contains unsafe context
  const adapter = new HayaseTorrentSource()

  // When: adapter request preparation reaches the hostile getter
  const error = await captureError(adapter.single(hostileQuery))

  // Then: no raw message, stack, JSON field, or cause crosses the boundary
  expectSanitized(error)
})

test("sanitizes unexpected result mapping failures", async () => {
  // Given: successful discovery and a hostile Date constructor reached only during result mapping
  const injectedFetch: InjectedFetch = (input) =>
    Promise.resolve(
      new URL(input.toString()).pathname.endsWith("/app/search/releases")
        ? jsonResponse([seasonOneRelease])
        : jsonResponse([seasonOneTorrent]),
    )
  globalThis.Date = new Proxy(originalDate, {
    construct() {
      throw new MissingAdapterError(unsafeContext)
    },
  })

  // When: a discovered torrent is projected to a Hayase result
  const error = await captureError(new HayaseTorrentSource().single(query(injectedFetch)))

  // Then: mapping implementation details remain context-free
  expectSanitized(error)
})

test("translates only typed infrastructure failures without query leakage", async () => {
  // Given: an injected transport failure carrying sensitive request context
  const injectedFetch: InjectedFetch = () => Promise.reject(new MissingAdapterError(unsafeContext))
  const adapter = new HayaseTorrentSource()

  // When: discovery reaches the failed infrastructure boundary
  const error = await captureError(adapter.single(query(injectedFetch)))

  // Then: only the stable adapter category and message cross the Worker boundary
  expectSanitized(error)
  expect(JSON.stringify(error)).not.toContain("Hell Mode")
})
