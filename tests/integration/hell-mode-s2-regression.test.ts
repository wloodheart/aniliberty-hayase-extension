import { expect, test } from "bun:test"

import { HayaseTorrentSource } from "../../src/hayase/adapter.ts"
import type { AnimeQueryWithFetch, InjectedFetch } from "../../src/hayase/types.ts"
import {
  seasonOneTorrent,
  seasonTwoRelease,
  seasonTwoTorrent,
  torrentWith,
} from "../helpers/discovery-fixtures.ts"

const outboundTitle =
  "Hell Mode: The Hardcore Gamer Dominates in Another World with Garbage Balancing Season 2"
const matchingRomajiTitle = "Hell Mode 2nd Season"

type RecordedRequests = {
  readonly searchQueries: string[]
  readonly torrentReleaseIds: number[]
}

function media(romaji: string): unknown {
  return {
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
  }
}

function query(fetch: InjectedFetch, romaji: string): AnimeQueryWithFetch {
  return {
    media: media(romaji),
    anilistId: 209983,
    titles: [outboundTitle],
    episode: 4,
    resolution: "1080",
    exclusions: ["HEVC"],
    fetch,
  }
}

test("uses trusted AniList aliases only for local Hell Mode season-two matching", async () => {
  // Given: the live-style Hayase title mismatch and AVC/HEVC torrents covering episodes one to five
  const avcTorrent = torrentWith(seasonTwoTorrent, {
    hash: seasonOneTorrent.hash,
    magnet: seasonOneTorrent.magnet,
    label: "Synthetic S2 pack [1080p][AVC][1-5]",
    codec: seasonOneTorrent.codec,
  })
  const recorded: RecordedRequests = { searchQueries: [], torrentReleaseIds: [] }
  const injectedFetch: InjectedFetch = (input) => {
    const url = new URL(input.toString())
    if (url.pathname.endsWith("/app/search/releases")) {
      const searchQuery = url.searchParams.get("query")
      if (searchQuery === null) throw new TypeError("Search request omitted its query")
      recorded.searchQueries.push(searchQuery)
      return Promise.resolve(Response.json([seasonTwoRelease]))
    }
    if (url.pathname.endsWith("/anime/torrents/release/10239")) {
      recorded.torrentReleaseIds.push(10239)
      return Promise.resolve(Response.json([seasonTwoTorrent, avcTorrent]))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  }
  const source = new HayaseTorrentSource()

  // When: matching and unrelated local romaji aliases are evaluated with the same outbound title
  const matching = await source.batch(query(injectedFetch, matchingRomajiTitle))
  expect(matching.map(({ hash, title }) => ({ hash, title }))).toEqual([
    { hash: avcTorrent.hash, title: avcTorrent.label },
  ])
  expect(recorded.searchQueries).toEqual([outboundTitle])
  expect(recorded.torrentReleaseIds).toEqual([10239])
  recorded.searchQueries.length = 0
  recorded.torrentReleaseIds.length = 0
  const unrelated = await source.batch(query(injectedFetch, "Unrelated Adventure 2nd Season"))

  // Then: only the local matching alias selects the eligible AVC torrent without adding a search title
  expect(unrelated).toEqual([])
  expect(recorded.searchQueries).toEqual([outboundTitle])
  expect(recorded.torrentReleaseIds).toEqual([])
})
