import {
  InfoHashSchema,
  type SearchRelease,
  SearchReleasesSchema,
  type Torrent,
  TorrentListSchema,
} from "../../src/aniliberty/schemas.ts"
import type { DiscoveryRequest } from "../../src/discovery/discover.ts"

const seasonOneSearch = await Bun.file("tests/fixtures/aniliberty/search-hell-mode-s1.json").json()
const seasonTwoSearch = await Bun.file("tests/fixtures/aniliberty/search-hell-mode-s2.json").json()
const seasonOneTorrents = await Bun.file(
  "tests/fixtures/aniliberty/torrents-hell-mode-s1.json",
).json()
const seasonTwoTorrents = await Bun.file(
  "tests/fixtures/aniliberty/torrents-hell-mode-s2.json",
).json()

function firstFixture<T>(values: readonly T[]): T {
  const value = values[0]
  if (value === undefined) throw new TypeError("Reduced discovery fixture must contain one record")
  return value
}

export const seasonOneRelease = firstFixture(SearchReleasesSchema.parse(seasonOneSearch))
export const seasonTwoRelease = firstFixture(SearchReleasesSchema.parse(seasonTwoSearch))
export const seasonOneTorrent = firstFixture(TorrentListSchema.parse(seasonOneTorrents))
export const seasonTwoTorrent = firstFixture(TorrentListSchema.parse(seasonTwoTorrents))

export const baseDiscoveryRequest = {
  mediaId: 1,
  titles: ["Hell Mode"],
  startYear: 2026,
  episodeCount: 12,
  episode: 6,
  resolution: "1080",
  exclusions: [],
  mode: "single",
} satisfies DiscoveryRequest

export function releaseWith(
  release: SearchRelease,
  changes: Partial<SearchRelease>,
): SearchRelease {
  return { ...release, ...changes }
}

export function torrentWith(torrent: Torrent, changes: Partial<Torrent>): Torrent {
  return { ...torrent, ...changes }
}

export function differentHashTorrent(torrent: Torrent): Torrent {
  const hash = InfoHashSchema.parse("3333333333333333333333333333333333333333")
  return {
    ...torrent,
    hash,
    magnet: `magnet:?xt=urn:btih:${hash}&dn=synthetic-alternate`,
  }
}
