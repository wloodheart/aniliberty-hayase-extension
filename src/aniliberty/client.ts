import { type AniLibertyFetch, InternalAniLibertyClient } from "./internal-client.ts"
import { scheduleDeadline, sleep } from "./request-runtime.ts"
import type { AppStatus, ReleaseId, SearchRelease, Torrent } from "./schemas.ts"

const PRODUCTION_BASE_URL = new URL("https://aniliberty.top/api/v1/")

export type { AniLibertyFetch } from "./internal-client.ts"

export class AniLibertyClient {
  private readonly internalClient: InternalAniLibertyClient

  constructor(fetch: AniLibertyFetch) {
    this.internalClient = new InternalAniLibertyClient({
      baseUrl: PRODUCTION_BASE_URL,
      fetch: fetch.bind(globalThis),
      healthFetch: globalThis.fetch.bind(globalThis),
      now: Date.now,
      scheduleDeadline,
      sleep,
    })
  }

  health(signal?: AbortSignal): Promise<AppStatus> {
    return this.internalClient.health(signal)
  }

  searchReleases(query: string, signal?: AbortSignal): Promise<SearchRelease[]> {
    return this.internalClient.searchReleases(query, signal)
  }

  releaseTorrents(releaseId: ReleaseId, signal?: AbortSignal): Promise<Torrent[]> {
    return this.internalClient.releaseTorrents(releaseId, signal)
  }
}
