import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import {
  createReleaseWorkspace,
  type ReleaseWorkspace,
  removeReleaseWorkspace,
} from "./support/artifacts.ts"
import {
  HayaseWorkerHarness,
  type SanitizedTorrentResult,
  type WorkerQuery,
} from "./support/hayase-harness.ts"

const fixtures = join(import.meta.dir, "..", "fixtures", "aniliberty")
const status = readFileSync(join(fixtures, "status.json"), "utf8")
const seasonOneSearch = JSON.parse(readFileSync(join(fixtures, "search-hell-mode-s1.json"), "utf8"))
const seasonTwoSearch = JSON.parse(readFileSync(join(fixtures, "search-hell-mode-s2.json"), "utf8"))
const seasonOneTorrents = JSON.parse(
  readFileSync(join(fixtures, "torrents-hell-mode-s1.json"), "utf8"),
)
const seasonTwoTorrents = JSON.parse(
  readFileSync(join(fixtures, "torrents-hell-mode-s2.json"), "utf8"),
)
const originalFetch = globalThis.fetch

type RequestCounts = { searches: number; torrents: number; statuses: number }

function seriesMedia(id: number, title: string, episodes: number): unknown {
  return {
    id,
    title: { userPreferred: title, english: title, romaji: title, native: null },
    startDate: { year: 2026 },
    episodes,
    format: "TV",
  }
}

function query(overrides: Partial<WorkerQuery> = {}): WorkerQuery {
  return {
    media: seriesMedia(1, "Hell Mode", 12),
    anilistId: 1,
    titles: ["Hell Mode"],
    episode: 5,
    episodeCount: 12,
    resolution: "1080",
    exclusions: [],
    ...overrides,
  }
}

function expectSerializable(results: readonly SanitizedTorrentResult[]): void {
  const cloned = structuredClone(results)
  const serialized = JSON.parse(JSON.stringify(cloned))
  expect(serialized).toHaveLength(results.length)
  for (const result of cloned) {
    expect(result.hash).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
    expect(result.link.startsWith("magnet:?xt=")).toBeTrue()
    expect(Number.isFinite(result.seeders) && result.seeders >= 0).toBeTrue()
    expect(Number.isFinite(result.leechers) && result.leechers >= 0).toBeTrue()
    expect(Number.isFinite(result.downloads) && result.downloads >= 0).toBeTrue()
    expect(Number.isFinite(result.size) && result.size > 0).toBeTrue()
    expect(result.date).toBeInstanceOf(Date)
    expect(Number.isNaN(result.date.getTime())).toBeFalse()
  }
}

let workspace: ReleaseWorkspace | undefined

beforeAll(async () => {
  workspace = await createReleaseWorkspace()
  globalThis.fetch = Object.assign(
    () => Promise.reject(new TypeError("Live network access is disabled in E2E tests")),
    { preconnect: originalFetch.preconnect },
  )
})

afterAll(() => {
  globalThis.fetch = originalFetch
  removeReleaseWorkspace(workspace)
})

describe("generated artifact in the Hayase-compatible Worker", () => {
  test("coalesces simultaneous series calls, sanitizes results, and applies exclusions", async () => {
    const activeWorkspace = workspace
    if (activeWorkspace === undefined) throw new TypeError("Release workspace is unavailable")
    const avc = seasonOneTorrents[0]
    const hevc = {
      ...avc,
      id: 31002,
      hash: "3333333333333333333333333333333333333333333333333333333333333333",
      label: "Synthetic S1 pack [1080p][HEVC][1-12]",
      codec: { ...avc.codec, value: "x265/HEVC", label: "HEVC" },
      magnet:
        "magnet:?xt=urn:btmh:12203333333333333333333333333333333333333333333333333333333333333333&dn=synthetic-s1-hevc",
    }
    const duplicate = { ...avc, id: 31003, label: "Duplicate S1 AVC identity" }
    const counts: RequestCounts = { searches: 0, torrents: 0, statuses: 0 }

    await withAniLibertyServer(
      (request) => {
        const path = new URL(request.url).pathname
        if (path.endsWith("/status")) {
          counts.statuses += 1
          return jsonResponse(status)
        }
        if (path.endsWith("/app/search/releases")) {
          counts.searches += 1
          return Response.json(seasonOneSearch)
        }
        counts.torrents += 1
        return Response.json([avc, hevc, duplicate])
      },
      async (baseUrl) => {
        await using harness = await HayaseWorkerHarness.create(activeWorkspace, baseUrl)
        expect(await harness.call("test")).toBeTrue()
        const [single, batch] = await Promise.all([
          harness.call("single", query()),
          harness.call("batch", query()),
        ])
        const excluded = await harness.call("batch", query({ exclusions: [" HEVC "] }))
        if (!Array.isArray(single) || !Array.isArray(batch) || !Array.isArray(excluded)) {
          throw new TypeError("Search calls must return result arrays")
        }
        expect(single.map(({ hash }) => hash)).toEqual([avc.hash, hevc.hash])
        expect(batch.map(({ hash }) => hash)).toEqual([avc.hash, hevc.hash])
        expect(single.every(({ type }) => type === "batch")).toBeTrue()
        expect(excluded.map(({ hash }) => hash)).toEqual([avc.hash])
        expectSerializable(single)
      },
    )

    expect(counts).toEqual({ searches: 1, torrents: 1, statuses: 1 })
  })

  test("returns no out-of-range S2 result and rejects TV candidates in movie mode", async () => {
    const activeWorkspace = workspace
    if (activeWorkspace === undefined) throw new TypeError("Release workspace is unavailable")
    const counts: RequestCounts = { searches: 0, torrents: 0, statuses: 0 }

    await withAniLibertyServer(
      (request) => {
        const url = new URL(request.url)
        if (url.pathname.endsWith("/app/search/releases")) {
          counts.searches += 1
          return Response.json(
            url.searchParams.get("query")?.includes("2nd") ? seasonTwoSearch : seasonOneSearch,
          )
        }
        counts.torrents += 1
        return Response.json(seasonTwoTorrents)
      },
      async (baseUrl) => {
        await using harness = await HayaseWorkerHarness.create(activeWorkspace, baseUrl)
        const outside = await harness.call(
          "single",
          query({
            media: seriesMedia(2, "Hell Mode 2nd Season", 5),
            anilistId: 2,
            titles: ["Hell Mode 2nd Season"],
            episode: 6,
            episodeCount: 5,
          }),
        )
        const movie = await harness.call("movie", {
          ...query(),
          media: {
            id: 3,
            title: { userPreferred: "Hell Mode", english: "Hell Mode", romaji: null, native: null },
            startDate: { year: 2026 },
            episodes: 1,
            format: "MOVIE",
          },
          anilistId: 3,
          episodeCount: 1,
        })
        expect(outside).toEqual([])
        expect(movie).toEqual([])
      },
    )

    expect(counts).toEqual({ searches: 2, torrents: 1, statuses: 0 })
  })
})
