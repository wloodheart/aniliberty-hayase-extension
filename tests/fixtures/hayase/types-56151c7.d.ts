export type Accuracy = "high" | "medium" | "low"
type CountryCodes = "ALL" | "RU"

export type SearchOptions = Record<
  string,
  {
    type: "string" | "number" | "boolean" | "select"
    description: string
    values?: unknown[]
    default: unknown
  }
>

export interface ExtensionConfig {
  manifestVersion: number
  deprecated: boolean
  name: string
  version: string
  description: string
  id: string
  type: "torrent" | "nzb" | "subtitle" | "http"
  accuracy: Accuracy
  ratio?: "perma" | number
  icon: string
  media: "sub" | "dub" | "both"
  url?: string
  languages: CountryCodes[]
  update?: string
  code: string
  options?: SearchOptions
  updatePeers?: false
  rateLimit?: number
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
