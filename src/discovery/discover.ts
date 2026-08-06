import type { ReleaseId, SearchRelease } from "../aniliberty/schemas.ts"
import { selectSearchTitles } from "../matching/normalize.ts"
import {
  matchRelease,
  type ReleaseCandidate,
  type ReleaseMatchQuery,
} from "../matching/release-matcher.ts"
import { PromiseLruCache } from "./cache.ts"
import { filterTorrents } from "./torrent-filter.ts"
import type {
  DiscoveredTorrent,
  DiscoveryClient,
  DiscoveryRequest,
  UnfilteredDiscoveryRecord,
} from "./types.ts"

export type { DiscoveredTorrent, DiscoveryClient, DiscoveryRequest } from "./types.ts"

const CACHE_TTL_MILLISECONDS = 60_000
const CACHE_MAX_ENTRIES = 64

type CandidateRecord = {
  readonly candidate: ReleaseCandidate
  readonly release: SearchRelease
}

function mediaKind(release: SearchRelease): ReleaseCandidate["mediaKind"] {
  return release.type.value.toLowerCase() === "movie" ? "movie" : "series"
}

function candidateRecord(release: SearchRelease): CandidateRecord {
  return {
    candidate: {
      alternativeTitles: release.name.alternative ?? "",
      englishTitle: release.name.english,
      episodesTotal: release.episodes_total,
      id: release.id,
      isBlockedByCopyrights: release.is_blocked_by_copyrights,
      isBlockedByGeo: release.is_blocked_by_geo,
      isCompleted: false,
      mainTitle: release.name.main,
      mediaKind: mediaKind(release),
      startYear: release.year,
    },
    release,
  }
}

function hasEqualMatchingFields(left: SearchRelease, right: SearchRelease): boolean {
  return (
    left.type.value === right.type.value &&
    left.year === right.year &&
    left.name.main === right.name.main &&
    left.name.english === right.name.english &&
    left.name.alternative === right.name.alternative &&
    left.season.value === right.season.value &&
    left.episodes_total === right.episodes_total &&
    left.is_blocked_by_geo === right.is_blocked_by_geo &&
    left.is_blocked_by_copyrights === right.is_blocked_by_copyrights
  )
}

function mergeConsistentReleases(
  searchResults: readonly (readonly SearchRelease[])[],
): readonly SearchRelease[] {
  const releases = new Map<ReleaseId, SearchRelease>()
  const conflictedIds = new Set<ReleaseId>()

  for (const result of searchResults) {
    for (const release of result) {
      if (conflictedIds.has(release.id)) continue
      const existing = releases.get(release.id)
      if (existing === undefined) {
        releases.set(release.id, release)
      } else if (!hasEqualMatchingFields(existing, release)) {
        releases.delete(release.id)
        conflictedIds.add(release.id)
      }
    }
  }

  return Array.from(releases.values())
}

function matchingQuery(request: DiscoveryRequest): ReleaseMatchQuery {
  return {
    episodeCount: request.episodeCount,
    mode: request.mode === "movie" ? "movie" : "series",
    requestedEpisode: request.episode,
    startYear: request.startYear,
    titles: request.titles,
  }
}

function cacheKey(request: DiscoveryRequest): string {
  return JSON.stringify([
    request.mediaId,
    request.titles,
    request.startYear,
    request.episodeCount,
    request.episode,
    request.mode === "movie" ? "movie" : "series",
  ])
}

export class DiscoveryService {
  private readonly cache: PromiseLruCache<string, UnfilteredDiscoveryRecord | null>

  constructor(
    private readonly client: DiscoveryClient,
    now: () => number = Date.now,
  ) {
    this.cache = new PromiseLruCache({
      maxEntries: CACHE_MAX_ENTRIES,
      now,
      ttlMilliseconds: CACHE_TTL_MILLISECONDS,
    })
  }

  async discover(request: DiscoveryRequest): Promise<readonly DiscoveredTorrent[]> {
    const record = await this.cache.getOrLoad(cacheKey(request), () => this.load(request))
    return filterTorrents(record, request)
  }

  private async load(request: DiscoveryRequest): Promise<UnfilteredDiscoveryRecord | null> {
    const titles = selectSearchTitles(request.titles)
    if (titles.length === 0) return null

    const searchResults = await Promise.all(
      titles.map((title) => this.client.searchReleases(title)),
    )
    const records = mergeConsistentReleases(searchResults).map(candidateRecord)
    const match = matchRelease(
      matchingQuery(request),
      records.map(({ candidate }) => candidate),
    )
    if (match.kind === "none") return null

    const winner = records.find(({ candidate }) => candidate === match.candidate)
    if (winner === undefined) return null
    const torrents = await this.client.releaseTorrents(winner.release.id)
    return { release: winner.release, torrents }
  }
}
