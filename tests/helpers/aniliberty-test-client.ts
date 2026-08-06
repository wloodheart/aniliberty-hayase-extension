import {
  type AniLibertyFetch,
  InternalAniLibertyClient,
} from "../../src/aniliberty/internal-client.ts"
import {
  type DeadlineScheduler,
  type RetrySleeper,
  scheduleDeadline,
  sleep,
} from "../../src/aniliberty/request-runtime.ts"

export type TestClientOptions = {
  readonly fetch?: AniLibertyFetch
  readonly healthFetch?: AniLibertyFetch
  readonly now?: () => number
  readonly scheduleDeadline?: DeadlineScheduler
  readonly sleep?: RetrySleeper
}

export function createTestAniLibertyClient(
  baseUrl: URL,
  options: TestClientOptions = {},
): InternalAniLibertyClient {
  return new InternalAniLibertyClient({
    baseUrl,
    fetch: options.fetch ?? globalThis.fetch,
    healthFetch: options.healthFetch ?? globalThis.fetch,
    now: options.now ?? Date.now,
    scheduleDeadline: options.scheduleDeadline ?? scheduleDeadline,
    sleep: options.sleep ?? sleep,
  })
}
