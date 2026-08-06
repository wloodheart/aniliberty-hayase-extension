import { expect, test } from "bun:test"
import { getEventListeners } from "node:events"

import { AniLibertyClient } from "../../src/aniliberty/client.ts"
import {
  AniLibertyClientError,
  AniLibertyHttpError,
  AniLibertyTimeoutError,
  AniLibertyTransientError,
  AniLibertyTransportError,
} from "../../src/aniliberty/errors.ts"
import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import { createTestAniLibertyClient } from "../helpers/aniliberty-test-client.ts"
import { trackBodyCancellation } from "../helpers/cancellation-fetch.ts"

const searchBody = await Bun.file("tests/fixtures/aniliberty/search-hell-mode-s1.json").text()
const unsafeSchedulerMessage = "Hell Mode https://outside.example private payload"

class MissingReviewError extends Error {
  readonly name = "MissingReviewError"
}

class UnsafeSchedulerError extends Error {
  readonly name = "UnsafeSchedulerError"
}

async function captureClientError(action: Promise<unknown>): Promise<AniLibertyClientError> {
  try {
    await action
  } catch (error) {
    if (error instanceof AniLibertyClientError) return error
    throw error
  }
  throw new MissingReviewError("Expected client failure")
}

function streamingResponse(status: number): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("unparsed streaming body"))
      },
    }),
    { headers: { "content-type": "application/json" }, status },
  )
}

test("cancels both streaming transient bodies before exhaustion", async () => {
  // Given: two real streaming 503 responses observed through the injected wire fetch
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return streamingResponse(503)
    },
    async (baseUrl) => {
      const tracked = trackBodyCancellation(globalThis.fetch)
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: tracked.fetch,
        sleep: () => Promise.resolve(),
      })

      // When: the only retry is exhausted
      const action = client.searchReleases("Hell Mode")

      // Then: each unparsed body is cancelled before typed exhaustion settles
      await expect(action).rejects.toBeInstanceOf(AniLibertyTransientError)
      expect(requests).toBe(2)
      expect(tracked.cancellationCount()).toBe(2)
    },
  )
})

test("cancels a streaming permanent body before HTTP failure", async () => {
  // Given: a real streaming 404 response observed through the injected wire fetch
  await withAniLibertyServer(
    () => streamingResponse(404),
    async (baseUrl) => {
      const tracked = trackBodyCancellation(globalThis.fetch)
      const client = createTestAniLibertyClient(baseUrl, { fetch: tracked.fetch })

      // When: the permanent status is classified
      const error = await captureClientError(client.searchReleases("Hell Mode"))

      // Then: disposal precedes the safe typed HTTP error
      expect(error).toBeInstanceOf(AniLibertyHttpError)
      expect(tracked.cancellationCount()).toBe(1)
    },
  )
})

test("production construction cannot redirect AniLiberty requests", async () => {
  // Given: a consumer attempts to supply an outside base URL
  let requestedUrl = ""
  const client = new AniLibertyClient((input) => {
    requestedUrl = input.toString()
    return Promise.resolve(jsonResponse(searchBody))
  })

  // When: production search builds its request
  await client.searchReleases("Hell Mode")

  // Then: only the fixed production endpoint is reachable
  expect(requestedUrl).toBe("https://aniliberty.top/api/v1/app/search/releases?query=Hell+Mode")
})

test("scheduler setup failure is safe and removes the caller listener", async () => {
  // Given: a caller signal and a scheduler that throws unsafe synchronous data
  const controller = new AbortController()
  const client = createTestAniLibertyClient(new URL("http://127.0.0.1/api/v1/"), {
    fetch: globalThis.fetch,
    scheduleDeadline: () => {
      throw new UnsafeSchedulerError(unsafeSchedulerMessage)
    },
  })

  // When: scheduler setup fails before fetch
  const error = await captureClientError(client.searchReleases("Hell Mode", controller.signal))

  // Then: failure is safely typed and the installed abort listener is removed
  expect(error).toBeInstanceOf(AniLibertyTransportError)
  expect(JSON.stringify(error)).not.toContain(unsafeSchedulerMessage)
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
})

test("real health retry and timeout settle with scheduling headroom", async () => {
  // Given: one retryable response followed by a streaming response that never completes
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      if (requests === 1) {
        return new Response(null, { headers: { "retry-after": "1" }, status: 503 })
      }
      return streamingResponse(200)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)
      const startedAt = performance.now()

      // When: the real retry delay and second request deadline run
      const action = client.health()

      // Then: timeout settles below the public 3500 ms wall-clock limit
      await expect(action).rejects.toBeInstanceOf(AniLibertyTimeoutError)
      expect(performance.now() - startedAt).toBeLessThan(3400)
      expect(requests).toBe(2)
    },
  )
})
