export const HAYASE_MANIFEST_VERSION = 2 as const

export type Accuracy = "high" | "medium" | "low"
export type ExtensionMedia = "sub" | "dub" | "both"
export type Resolution = "2160" | "1080" | "720" | "540" | "480" | ""
export type TorrentResultType = "batch" | "best" | "alt"
export type SearchOptionValue = boolean | number | string
export type SearchOptions = Readonly<Record<string, SearchOptionValue>>

export type InjectedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type HayaseManifestV2 = {
  readonly manifestVersion: typeof HAYASE_MANIFEST_VERSION
  readonly deprecated: boolean
  readonly name: string
  readonly version: string
  readonly description: string
  readonly id: string
  readonly type: "torrent"
  readonly accuracy: Accuracy
  readonly icon: string
  readonly media: ExtensionMedia
  readonly languages: readonly string[]
  readonly update: string
  readonly code: string
  readonly updatePeers?: false
}

export type AnimeQuery = {
  readonly media: unknown
  readonly anilistId: number
  readonly anidbAid?: number
  readonly anidbEid?: number
  readonly tvdbId?: number
  readonly tvdbEId?: number
  readonly imdbId?: string
  readonly tmdbId?: string
  readonly titles: readonly string[]
  readonly episode: number
  readonly episodeCount?: number
  readonly absoluteEpisodeNumber?: number
  readonly resolution: Resolution
  readonly exclusions: readonly string[]
}

export type AnimeQueryWithFetch = AnimeQuery & {
  readonly fetch: InjectedFetch
}

export type TorrentResult = {
  readonly title: string
  readonly link: string
  readonly id?: number
  readonly seeders: number
  readonly leechers: number
  readonly downloads: number
  readonly accuracy: Accuracy
  readonly hash: string
  readonly size: number
  readonly date: Date
  readonly type?: TorrentResultType
}

export type TorrentSearch = (
  query: AnimeQueryWithFetch,
  options?: SearchOptions,
) => Promise<readonly TorrentResult[]>

export interface TorrentSource {
  readonly test: () => Promise<boolean>
  readonly single: TorrentSearch
  readonly batch: TorrentSearch
  readonly movie: TorrentSearch
}
