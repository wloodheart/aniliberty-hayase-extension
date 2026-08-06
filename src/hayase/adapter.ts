import { z } from "zod"

import { AniLibertyClient } from "../aniliberty/client.ts"
import { DiscoveryService } from "../discovery/discover.ts"
import type { DiscoveredTorrent, DiscoveryMode, DiscoveryRequest } from "../discovery/types.ts"
import type {
  AnimeQueryWithFetch,
  InjectedFetch,
  TorrentResult,
  TorrentSearch,
  TorrentSource,
} from "./types.ts"

const seriesFormats = ["TV", "TV_SHORT", "SPECIAL", "OVA", "ONA", "MUSIC"] as const
const AniListMediaIdSchema = z.int().positive().brand("AniListMediaId")

const AniListMediaSchema = z
  .object({
    id: AniListMediaIdSchema,
    title: z.object({
      userPreferred: z.string().min(1).nullable(),
      english: z.string().min(1).nullable(),
      romaji: z.string().min(1).nullable(),
      native: z.string().min(1).nullable(),
    }),
    startDate: z.object({ year: z.int().positive().nullable() }),
    episodes: z.int().positive().nullable(),
    format: z.union([
      z.literal("MOVIE").transform(() => "movie" as const),
      z.enum(seriesFormats).transform(() => "series" as const),
    ]),
  })
  .transform((media) => ({
    episodeCount: media.episodes,
    id: media.id,
    kind: media.format,
    startYear: media.startDate.year,
  }))

const mediaKindByMode = {
  single: "series",
  batch: "series",
  movie: "movie",
} as const satisfies Readonly<Record<DiscoveryMode, "movie" | "series">>

class TorrentSourceUnavailableError extends Error {
  readonly name = "TorrentSourceUnavailableError"

  constructor() {
    super("AniLiberty is unavailable")
  }
}

function toTorrentResult(discovered: DiscoveredTorrent): TorrentResult {
  const { torrent, type } = discovered
  return {
    title: torrent.label,
    link: torrent.magnet,
    id: torrent.id,
    seeders: torrent.seeders,
    leechers: torrent.leechers,
    downloads: torrent.completed_times,
    accuracy: "medium",
    hash: torrent.hash,
    size: torrent.size,
    date: new Date(torrent.created_at),
    ...(type === undefined ? {} : { type }),
  }
}

export class HayaseTorrentSource implements TorrentSource {
  private readonly services = new WeakMap<InjectedFetch, DiscoveryService>()

  readonly test = async (): Promise<boolean> => {
    try {
      return (await new AniLibertyClient(globalThis.fetch).health()).is_alive
    } catch {
      throw new TorrentSourceUnavailableError()
    }
  }

  readonly single: TorrentSearch = (query) => this.search(query, "single")
  readonly batch: TorrentSearch = (query) => this.search(query, "batch")
  readonly movie: TorrentSearch = (query) => this.search(query, "movie")

  private serviceFor(fetch: InjectedFetch): DiscoveryService {
    const existing = this.services.get(fetch)
    if (existing !== undefined) return existing
    const service = new DiscoveryService(new AniLibertyClient(fetch))
    this.services.set(fetch, service)
    return service
  }

  private async search(query: AnimeQueryWithFetch, mode: DiscoveryMode): Promise<TorrentResult[]> {
    try {
      const parsed = AniListMediaSchema.safeParse(query.media)
      const queryMediaId = AniListMediaIdSchema.safeParse(query.anilistId)
      if (
        !parsed.success ||
        !queryMediaId.success ||
        parsed.data.id !== queryMediaId.data ||
        parsed.data.kind !== mediaKindByMode[mode]
      ) {
        return []
      }
      const media = parsed.data
      const request: DiscoveryRequest = {
        mediaId: queryMediaId.data,
        titles: query.titles,
        startYear: media.startYear,
        episodeCount: query.episodeCount ?? media.episodeCount,
        episode: query.episode,
        resolution: query.resolution,
        exclusions: query.exclusions,
        mode,
      }
      const discovered = await this.serviceFor(query.fetch).discover(request)
      return discovered.map(toTorrentResult)
    } catch {
      throw new TorrentSourceUnavailableError()
    }
  }
}
