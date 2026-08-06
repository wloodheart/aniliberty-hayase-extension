import { expect, test } from "bun:test"
import {
  AniLibertyAbortedError,
  AniLibertyTimeoutError,
  AniLibertyTransientError,
} from "../../src/aniliberty/errors.ts"
import { parseRetryAfterMilliseconds } from "../../src/aniliberty/request-runtime.ts"
import { ReleaseIdSchema } from "../../src/aniliberty/schemas.ts"
import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import { createTestAniLibertyClient } from "../helpers/aniliberty-test-client.ts"

const searchBody = await Bun.file("tests/fixtures/aniliberty/search-hell-mode-s1.json").text()

test("retries one transient response and then returns parsed data", async () => {
  // Given: one 503 followed by a valid response and an immediate deterministic sleeper
  let requests = 0
  const delays: number[] = []
  await withAniLibertyServer(
    () => {
      requests += 1
      return requests === 1
        ? new Response(null, { headers: { "retry-after": "0.25" }, status: 503 })
        : jsonResponse(searchBody)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: globalThis.fetch,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      // When: search encounters the retryable response
      const releases = await client.searchReleases("Hell Mode")

      // Then: exactly one bounded delay and two wire requests occur
      expect(releases[0]?.id).toBe(ReleaseIdSchema.parse(10096))
      expect(delays).toEqual([250])
      expect(requests).toBe(2)
    },
  )
})

test("two transient responses produce typed exhaustion", async () => {
  // Given: a server that remains unavailable
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return new Response(null, { status: 503 })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: globalThis.fetch,
        sleep: () => Promise.resolve(),
      })

      // When: both allowed attempts are transient
      const action = client.searchReleases("Hell Mode")

      // Then: exhaustion is typed and no third request occurs
      await expect(action).rejects.toBeInstanceOf(AniLibertyTransientError)
      expect(requests).toBe(2)
    },
  )
})

test("caps a wire Retry-After delay before the only retry", async () => {
  // Given: a transient endpoint requesting a thirty-second delay
  let requests = 0
  const delays: number[] = []
  await withAniLibertyServer(
    () => {
      requests += 1
      return requests === 1
        ? new Response(null, { headers: { "retry-after": "30" }, status: 429 })
        : jsonResponse(searchBody)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: globalThis.fetch,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          return Promise.resolve()
        },
      })

      // When: search follows the server retry instruction
      await client.searchReleases("Hell Mode")

      // Then: the delay is capped and exactly one retry reaches the wire
      expect(delays).toEqual([1000])
      expect(requests).toBe(2)
    },
  )
})

test.each([
  ["30", 0, 1000],
  ["-4", 0, 0],
  ["invalid", 0, 0],
  ["Thu, 01 Jan 1970 00:00:30 GMT", 0, 1000],
  [null, 0, 0],
] as const)("bounds Retry-After %s", (value, now, expected) => {
  // Given: a Retry-After value and deterministic current time
  // When: the delay is parsed
  const milliseconds = parseRetryAfterMilliseconds(value, now)

  // Then: malformed, negative, date, and seconds values stay within one second
  expect(milliseconds).toBe(expected)
  expect(milliseconds).toBeLessThanOrEqual(1000)
})

test("external abort fails without a request or retry", async () => {
  // Given: an already-aborted caller signal
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return jsonResponse(searchBody)
    },
    async (baseUrl) => {
      const controller = new AbortController()
      controller.abort()
      const client = createTestAniLibertyClient(baseUrl)

      // When: search is called with the cancelled operation
      const action = client.searchReleases("Hell Mode", controller.signal)

      // Then: cancellation is typed and cannot be retried
      await expect(action).rejects.toBeInstanceOf(AniLibertyAbortedError)
      expect(requests).toBe(0)
    },
  )
})

test("internal request deadline aborts a live wire request and clears its resource", async () => {
  // Given: a server-triggered manual deadline and a tracked cleanup function
  let requests = 0
  let triggerDeadline: (() => void) | undefined
  let clearedDeadlines = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("["))
          queueMicrotask(() => triggerDeadline?.())
        },
      })
      return new Response(body, { headers: { "content-type": "application/json" } })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        scheduleDeadline: (abort, milliseconds) => {
          expect(milliseconds).toBe(3000)
          triggerDeadline = abort
          return () => {
            clearedDeadlines += 1
          }
        },
      })

      // When: the attempt deadline fires after the server receives the request
      const action = client.searchReleases("Hell Mode")

      // Then: timeout is typed, not retried, and timer cleanup runs
      await expect(action).rejects.toBeInstanceOf(AniLibertyTimeoutError)
      expect(requests).toBe(1)
      expect(clearedDeadlines).toBe(1)
    },
  )
})

test("health caps retry delay to its remaining total budget", async () => {
  // Given: a transient health response after 3000 ms of synthetic elapsed budget
  let now = 0
  let requests = 0
  const delays: number[] = []
  await withAniLibertyServer(
    () => {
      requests += 1
      now = 3000
      return new Response(null, { headers: { "retry-after": "9" }, status: 503 })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        now: () => now,
        sleep: (milliseconds) => {
          delays.push(milliseconds)
          now += milliseconds
          return Promise.resolve()
        },
      })

      // When: health spends most of its 3250 ms operational budget before retry delay
      const action = client.health()

      // Then: its whole-path delay cannot exceed the remaining 250 ms
      await expect(action).rejects.toBeInstanceOf(AniLibertyTimeoutError)
      expect(delays).toEqual([250])
      expect(now).toBe(3250)
      expect(requests).toBe(1)
    },
  )
})
