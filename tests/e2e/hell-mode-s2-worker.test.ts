import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { withAniLibertyServer } from "../helpers/aniliberty-server.ts"
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
const seasonTwoSearch = JSON.parse(readFileSync(join(fixtures, "search-hell-mode-s2.json"), "utf8"))
const seasonOneTorrents = JSON.parse(
  readFileSync(join(fixtures, "torrents-hell-mode-s1.json"), "utf8"),
)
const seasonTwoTorrents = JSON.parse(
  readFileSync(join(fixtures, "torrents-hell-mode-s2.json"), "utf8"),
)
const outboundTitle =
  "Hell Mode: The Hardcore Gamer Dominates in Another World with Garbage Balancing Season 2"
const matchingRomajiTitle = "Hell Mode 2nd Season"
const unrelatedRomajiTitle = "Unrelated Adventure 2nd Season"
const avcTorrent = {
  ...seasonTwoTorrents[0],
  hash: seasonOneTorrents[0].hash,
  label: "Synthetic S2 pack [1080p][AVC][1-5]",
  codec: seasonOneTorrents[0].codec,
  magnet: seasonOneTorrents[0].magnet,
}

type CapturedRequest = {
  readonly pathname: string
  readonly query: string | null
  readonly url: string
}

type WorkerRun = {
  readonly requests: readonly CapturedRequest[]
  readonly results: readonly SanitizedTorrentResult[]
}

function query(romaji: string): WorkerQuery {
  return {
    media: {
      id: 209983,
      title: {
        userPreferred: outboundTitle,
        english: outboundTitle,
        romaji,
        native: null,
      },
      startDate: { year: 2026 },
      episodes: null,
      format: "TV",
    },
    anilistId: 209983,
    titles: [outboundTitle],
    episode: 4,
    resolution: "1080",
    exclusions: ["HEVC"],
  }
}

let workspace: ReleaseWorkspace | undefined

beforeAll(async () => {
  workspace = await createReleaseWorkspace()
})

afterAll(() => removeReleaseWorkspace(workspace))

async function runBatch(romaji: string): Promise<WorkerRun> {
  const activeWorkspace = workspace
  if (activeWorkspace === undefined) throw new TypeError("Release workspace is unavailable")
  const requests: CapturedRequest[] = []

  const results = await withAniLibertyServer(
    (request) => {
      const url = new URL(request.url)
      requests.push({ pathname: url.pathname, query: url.searchParams.get("query"), url: url.href })
      if (url.pathname.endsWith("/app/search/releases")) return Response.json(seasonTwoSearch)
      return Response.json([seasonTwoTorrents[0], avcTorrent])
    },
    async (baseUrl) => {
      await using harness = await HayaseWorkerHarness.create(activeWorkspace, baseUrl)
      const value = await harness.call("batch", query(romaji))
      if (!Array.isArray(value)) throw new TypeError("Batch call must return a result array")
      return value
    },
  )

  return { requests, results }
}

describe("generated Worker Hell Mode season-two alias matching", () => {
  test("returns the episode-four AVC batch without sending the local romaji alias", async () => {
    // Given: the live-style Hayase title differs from the AniLiberty season title

    // When: the generated release artifact matches the trusted local romaji alias
    const run = await runBatch(matchingRomajiTitle)

    // Then: only the eligible episode 1-5 AVC batch is returned and only the Hayase title was sent
    expect(run.results.map(({ hash, title, type }) => ({ hash, title, type }))).toEqual([
      { hash: avcTorrent.hash, title: avcTorrent.label, type: "batch" },
    ])
    expect(run.results.map(({ hash }) => hash)).not.toContain(seasonTwoTorrents[0].hash)
    expect(run.requests.map(({ pathname }) => pathname)).toEqual([
      "/api/v1/app/search/releases",
      "/api/v1/anime/torrents/release/10239",
    ])
    expect(run.requests.map(({ query }) => query).filter((value) => value !== null)).toEqual([
      outboundTitle,
    ])
    expect(decodeURIComponent(run.requests.map(({ url }) => url).join("\n"))).not.toContain(
      matchingRomajiTitle,
    )
  })

  test("returns no result for an unrelated local romaji alias without leaking it", async () => {
    // Given: the same outbound Hayase title with an unrelated local romaji alias

    // When: the generated release artifact cannot match the local alias
    const run = await runBatch(unrelatedRomajiTitle)

    // Then: the ordinary empty result settles after one unchanged outbound search
    expect(run.results).toEqual([])
    expect(run.requests.map(({ pathname, query }) => ({ pathname, query }))).toEqual([
      { pathname: "/api/v1/app/search/releases", query: outboundTitle },
    ])
    expect(decodeURIComponent(run.requests[0]?.url ?? "")).not.toContain(unrelatedRomajiTitle)
  })
})
