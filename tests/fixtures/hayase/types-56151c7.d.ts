export type Accuracy = "high" | "medium" | "low"

export interface ExtensionConfig {
  manifestVersion: number
  deprecated: boolean
  name: string
  version: string
  description: string
  id: string
  type: "torrent" | "nzb" | "subtitle" | "http"
  accuracy: Accuracy
  icon: string
  media: "sub" | "dub" | "both"
  languages: string[]
  update?: string
  code: string
}

export interface TorrentResult {
  title: string
  link: string
  id?: number
  seeders: number
  leechers: number
  downloads: number
  accuracy: Accuracy
  hash: string
  size: number
  date: Date
  type?: "batch" | "best" | "alt"
}

export interface AnimeQuery {
  media: unknown
  anilistId: number
  anidbAid?: number
  anidbEid?: number
  tvdbId?: number
  tvdbEId?: number
  imdbId?: string
  tmdbId?: string
  titles: string[]
  episode: number
  episodeCount?: number
  absoluteEpisodeNumber?: number
  resolution: "2160" | "1080" | "720" | "540" | "480" | ""
  exclusions: string[]
}

export type AnimeQueryWithFetch = AnimeQuery & { fetch: typeof fetch }
export type SearchFunction = (
  query: AnimeQueryWithFetch,
  options?: Record<string, number | string | boolean>,
) => Promise<TorrentResult[]>

export class TorrentSource {
  test: () => Promise<boolean>
  single: SearchFunction
  batch: SearchFunction
  movie: SearchFunction
}
