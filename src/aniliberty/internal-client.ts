import type { ZodType } from "zod"

import { disposeResponseBody } from "./dispose-response.ts"
import {
  AniLibertyAbortedError,
  AniLibertyApiValidationError,
  AniLibertyClientError,
  type AniLibertyEndpoint,
  AniLibertyHttpError,
  AniLibertyTimeoutError,
  AniLibertyTransientError,
  AniLibertyTransportError,
} from "./errors.ts"
import {
  type DeadlineScheduler,
  HEALTH_BUDGET_MILLISECONDS,
  parseRetryAfterMilliseconds,
  REQUEST_TIMEOUT_MILLISECONDS,
  type RetrySleeper,
} from "./request-runtime.ts"
import { parseAniLibertyResponse } from "./response-parser.ts"
import {
  type AppStatus,
  AppStatusSchema,
  type ReleaseId,
  type SearchRelease,
  SearchReleasesSchema,
  type Torrent,
  TorrentListSchema,
  ValidationErrorSchema,
} from "./schemas.ts"

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504])

export type AniLibertyFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type InternalAniLibertyClientOptions = {
  readonly fetch: AniLibertyFetch
  readonly healthFetch: AniLibertyFetch
  readonly baseUrl: URL
  readonly sleep: RetrySleeper
  readonly now: () => number
  readonly scheduleDeadline: DeadlineScheduler
}

type RequestSpec<T> = {
  readonly endpoint: AniLibertyEndpoint
  readonly fetch: AniLibertyFetch
  readonly schema: ZodType<T>
  readonly signal: AbortSignal | undefined
  readonly url: URL
  readonly budgetMilliseconds: number | undefined
}

type AttemptResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "transient"; readonly retryAfter: string | null; readonly status: number }

export class InternalAniLibertyClient {
  private readonly baseUrl: URL
  private readonly discoveryFetch: AniLibertyFetch
  private readonly healthFetch: AniLibertyFetch
  private readonly retrySleep: RetrySleeper
  private readonly now: () => number
  private readonly deadlineScheduler: DeadlineScheduler

  constructor(options: InternalAniLibertyClientOptions) {
    this.baseUrl = new URL(options.baseUrl)
    this.discoveryFetch = options.fetch
    this.healthFetch = options.healthFetch
    this.retrySleep = options.sleep
    this.now = options.now
    this.deadlineScheduler = options.scheduleDeadline
  }

  health(signal?: AbortSignal): Promise<AppStatus> {
    return this.request({
      budgetMilliseconds: HEALTH_BUDGET_MILLISECONDS,
      endpoint: "health",
      fetch: this.healthFetch,
      schema: AppStatusSchema,
      signal,
      url: new URL("app/status", this.baseUrl),
    })
  }

  searchReleases(query: string, signal?: AbortSignal): Promise<SearchRelease[]> {
    const url = new URL("app/search/releases", this.baseUrl)
    url.searchParams.set("query", query)
    return this.request({
      budgetMilliseconds: undefined,
      endpoint: "search-releases",
      fetch: this.discoveryFetch,
      schema: SearchReleasesSchema,
      signal,
      url,
    })
  }

  releaseTorrents(releaseId: ReleaseId, signal?: AbortSignal): Promise<Torrent[]> {
    return this.request({
      budgetMilliseconds: undefined,
      endpoint: "release-torrents",
      fetch: this.discoveryFetch,
      schema: TorrentListSchema,
      signal,
      url: new URL(`anime/torrents/release/${releaseId}`, this.baseUrl),
    })
  }

  private async request<T>(spec: RequestSpec<T>): Promise<T> {
    const startedAt = this.now()
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const remaining = this.remainingBudget(spec, startedAt)
      if (remaining <= 0) {
        throw new AniLibertyTimeoutError(spec.endpoint, REQUEST_TIMEOUT_MILLISECONDS, attempt)
      }
      const timeout = Math.min(REQUEST_TIMEOUT_MILLISECONDS, remaining)
      const result = await this.attempt(spec, timeout, attempt)
      if (result.kind === "success") return result.value
      if (attempt === 2) {
        throw new AniLibertyTransientError(spec.endpoint, result.status, attempt)
      }
      const requestedDelay = parseRetryAfterMilliseconds(result.retryAfter, this.now())
      const delay = Math.min(requestedDelay, this.remainingBudget(spec, startedAt))
      await this.waitForRetry(spec, delay)
    }
    throw new AniLibertyTransientError(spec.endpoint, 503, 2)
  }

  private async attempt<T>(
    spec: RequestSpec<T>,
    timeout: number,
    attempt: number,
  ): Promise<AttemptResult<T>> {
    if (spec.signal?.aborted) throw new AniLibertyAbortedError(spec.endpoint)
    const controller = new AbortController()
    let timedOut = false
    const abortForCaller = (): void => controller.abort()
    spec.signal?.addEventListener("abort", abortForCaller, { once: true })
    let clearDeadline = (): void => undefined

    try {
      clearDeadline = this.deadlineScheduler(() => {
        timedOut = true
        controller.abort()
      }, timeout)
      return await this.executeAttempt(spec, controller.signal)
    } catch (error) {
      if (error instanceof AniLibertyClientError) throw error
      if (spec.signal?.aborted) throw new AniLibertyAbortedError(spec.endpoint)
      if (timedOut) throw new AniLibertyTimeoutError(spec.endpoint, timeout, attempt)
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AniLibertyAbortedError(spec.endpoint)
      }
      throw new AniLibertyTransportError(spec.endpoint)
    } finally {
      clearDeadline()
      spec.signal?.removeEventListener("abort", abortForCaller)
    }
  }

  private async executeAttempt<T>(
    spec: RequestSpec<T>,
    signal: AbortSignal,
  ): Promise<AttemptResult<T>> {
    const response = await spec.fetch(spec.url, { signal })
    if (TRANSIENT_STATUSES.has(response.status)) {
      const retryAfter = response.headers.get("retry-after")
      await disposeResponseBody(response)
      return {
        kind: "transient",
        retryAfter,
        status: response.status,
      }
    }
    if (response.status === 422) {
      await parseAniLibertyResponse(response, ValidationErrorSchema, spec.endpoint)
      throw new AniLibertyApiValidationError(spec.endpoint)
    }
    if (!response.ok) {
      await disposeResponseBody(response)
      throw new AniLibertyHttpError(spec.endpoint, response.status)
    }
    return {
      kind: "success",
      value: await parseAniLibertyResponse(response, spec.schema, spec.endpoint),
    }
  }

  private remainingBudget<T>(spec: RequestSpec<T>, startedAt: number): number {
    if (spec.budgetMilliseconds === undefined) return Number.POSITIVE_INFINITY
    return Math.max(spec.budgetMilliseconds - (this.now() - startedAt), 0)
  }

  private async waitForRetry<T>(spec: RequestSpec<T>, milliseconds: number): Promise<void> {
    try {
      await this.retrySleep(milliseconds, spec.signal)
    } catch (error) {
      if (spec.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new AniLibertyAbortedError(spec.endpoint)
      }
      throw new AniLibertyTransportError(spec.endpoint)
    }
  }
}
