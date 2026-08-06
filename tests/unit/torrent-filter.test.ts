import { expect, test } from "bun:test"

import { filterTorrents } from "../../src/discovery/torrent-filter.ts"
import {
  baseDiscoveryRequest,
  differentHashTorrent,
  seasonOneRelease,
  seasonOneTorrent,
  torrentWith,
} from "../helpers/discovery-fixtures.ts"

const unfiltered = {
  release: seasonOneRelease,
  torrents: [seasonOneTorrent],
}

test("keeps AVC when a case-insensitive HEVC exclusion is requested", () => {
  // Given: an AVC season pack and a differently cased HEVC exclusion
  const request = { ...baseDiscoveryRequest, exclusions: ["heVc"] }

  // When: the cached unfiltered record is filtered
  const results = filterTorrents(unfiltered, request)

  // Then: the unrelated codec survives with all AniLiberty metadata intact
  expect(results).toEqual([{ release: seasonOneRelease, torrent: seasonOneTorrent, type: "batch" }])
})

test.each([
  ["label", { label: "Synthetic HEVC pack [1080p]" }, "hevc"],
  ["codec value", { codec: { ...seasonOneTorrent.codec, value: "x265/HEVC" } }, "hevc"],
  ["codec label", { codec: { ...seasonOneTorrent.codec, label: "H.265" } }, "h.265"],
  ["source", { type: { value: "BluRay" } }, "bluray"],
  ["codec color", { codec: { ...seasonOneTorrent.codec, label_color: "Amber" } }, "amber"],
  ["quality", { quality: { value: "FullHD" } }, "fullhd"],
] as const)("applies exclusions across %s metadata", (_field, changes, exclusion) => {
  // Given: one exclusion appearing in a required metadata field
  const torrent = torrentWith(seasonOneTorrent, changes)

  // When: exclusion filtering runs
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [torrent] },
    { ...baseDiscoveryRequest, exclusions: [exclusion], resolution: "" },
  )

  // Then: the torrent is excluded regardless of field or casing
  expect(results).toEqual([])
})

test("fails closed for unknown, conflicting, or mismatched requested resolution", () => {
  // Given: torrents with unknown, conflicting, and lower resolution evidence
  const unknown = torrentWith(seasonOneTorrent, {
    label: "Synthetic pack",
    quality: { value: "FullHD" },
  })
  const conflicting = torrentWith(seasonOneTorrent, {
    label: "Synthetic pack [1080p][720p]",
  })
  const mismatch = torrentWith(seasonOneTorrent, {
    label: "Synthetic pack [720p]",
    quality: { value: "720p" },
  })

  // When: 1080 resolution is requested
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [unknown, conflicting, mismatch] },
    baseDiscoveryRequest,
  )

  // Then: no uncertain resolution is accepted
  expect(results).toEqual([])
})

test("rejects malformed and hash-inconsistent magnets from an untrusted fake client", () => {
  // Given: a malformed payload and a valid magnet naming a different digest
  const malformed = { ...seasonOneTorrent, magnet: "not-a-magnet" }
  const inconsistent = {
    ...seasonOneTorrent,
    magnet: "magnet:?xt=urn:btih:3333333333333333333333333333333333333333",
  }

  // When: raw cached torrent values cross the filter boundary
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [malformed, inconsistent] },
    baseDiscoveryRequest,
  )

  // Then: neither can become a discovery result
  expect(results).toEqual([])
})

test("single requires coverage and tags only a covering range as batch", () => {
  // Given: one single-episode torrent, one covering range, and one unrelated range
  const single = torrentWith(seasonOneTorrent, { description: "6" })
  const range = torrentWith(differentHashTorrent(seasonOneTorrent), { description: "1-12" })
  const unrelated = torrentWith(seasonOneTorrent, { description: "7-12" })

  // When: episode six is requested in single mode
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [single, range, unrelated] },
    baseDiscoveryRequest,
  )

  // Then: proven coverage survives and only the range receives the batch tag
  expect(results).toEqual([
    { release: seasonOneRelease, torrent: single },
    { release: seasonOneRelease, torrent: range, type: "batch" },
  ])
})

test("batch requires a primary season pack starting at episode one", () => {
  // Given: a single episode, a partial range, and a primary season pack
  const single = torrentWith(seasonOneTorrent, { description: "1" })
  const partial = torrentWith(seasonOneTorrent, { description: "2-12" })
  const pack = torrentWith(seasonOneTorrent, { description: "1-12" })

  // When: batch filtering runs
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [single, partial, pack] },
    { ...baseDiscoveryRequest, mode: "batch" },
  )

  // Then: only the primary multi-episode pack is returned as batch
  expect(results).toEqual([{ release: seasonOneRelease, torrent: pack, type: "batch" }])
})

test("movie requires a MOVIE release and leaves result type unset", () => {
  // Given: equivalent movie and TV records
  const movieRelease = { ...seasonOneRelease, type: { value: "MOVIE" } }
  const request = { ...baseDiscoveryRequest, mode: "movie" } as const

  // When: both are filtered in movie mode
  const movieResults = filterTorrents(
    { release: movieRelease, torrents: [seasonOneTorrent] },
    request,
  )
  const televisionResults = filterTorrents(unfiltered, request)

  // Then: only MOVIE survives and it has no type property
  expect(movieResults).toEqual([{ release: movieRelease, torrent: seasonOneTorrent }])
  expect(movieResults[0]).not.toHaveProperty("type")
  expect(televisionResults).toEqual([])
})
