import type { ReleaseId, SearchRelease, Torrent } from "../aniliberty/schemas.ts"
import type { Resolution } from "../hayase/types.ts"

export type DiscoveryMode = "single" | "batch" | "movie"

export type DiscoveryRequest = {
  readonly mediaId: number
  readonly titles: readonly string[]
  readonly matchingTitles: readonly string[]
  readonly startYear: number | null
  readonly episodeCount: number | null
  readonly episode: number
  readonly resolution: Resolution
  readonly exclusions: readonly string[]
  readonly mode: DiscoveryMode
}

export interface DiscoveryClient {
  searchReleases(query: string): Promise<readonly SearchRelease[]>

  releaseTorrents(releaseId: ReleaseId): Promise<readonly unknown[]>
}

export type UnfilteredDiscoveryRecord = {
  readonly release: SearchRelease
  readonly torrents: readonly unknown[]
}

export type DiscoveredTorrent = {
  readonly release: SearchRelease
  readonly torrent: Torrent
  readonly type?: "batch"
}
