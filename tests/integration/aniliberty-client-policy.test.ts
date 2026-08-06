import { expect, test } from "bun:test"

import { AniLibertyClient } from "../../src/aniliberty/client.ts"
import {
  AniLibertyAbortedError,
  AniLibertyClientError,
  AniLibertyHttpError,
  AniLibertyTransientError,
  AniLibertyTransportError,
} from "../../src/aniliberty/errors.ts"
import { sleep } from "../../src/aniliberty/request-runtime.ts"
import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import { createTestAniLibertyClient } from "../helpers/aniliberty-test-client.ts"

const statusBody = await Bun.file("tests/fixtures/aniliberty/status.json").text()
const unsafeFailure = "Hell Mode https://outside.example raw payload"

class MissingPolicyError extends Error {
  readonly name = "MissingPolicyError"
}

class UnsafePolicyError extends Error {
  readonly name = "UnsafePolicyError"
}

async function captureClientError(action: Promise<unknown>): Promise<AniLibertyClientError> {
  try {
    await action
  } catch (error) {
    if (error instanceof AniLibertyClientError) return error
    throw error
  }
  throw new MissingPolicyError("Expected client failure")
}

function streamingJsonResponse(status: number): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("["))
      },
    }),
    { headers: { "content-type": "application/json" }, status },
  )
}

test("production health uses global fetch and the fixed status URL", async () => {
  // Given: global health transport capture and a discovery fetch that must remain unused
  const originalFetch = globalThis.fetch
  let requestedUrl = ""
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL) => {
      requestedUrl = input.toString()
      return Promise.resolve(jsonResponse(statusBody))
    },
    { preconnect: originalFetch.preconnect },
  )

  try {
    const client = new AniLibertyClient(() =>
      Promise.reject(new MissingPolicyError("Discovery fetch used by health")),
    )

    // When: production health runs without a Hayase query fetch
    const status = await client.health()

    // Then: only global fetch and the fixed production status URL are used
    expect(status.is_alive).toBe(true)
    expect(requestedUrl).toBe("https://aniliberty.top/api/v1/app/status")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.each([429, 502, 503, 504] as const)(
  "retries transient status %i exactly once",
  async (status) => {
    // Given: a real endpoint that remains transient
    let requests = 0
    await withAniLibertyServer(
      () => {
        requests += 1
        return new Response(null, { status })
      },
      async (baseUrl) => {
        const client = createTestAniLibertyClient(baseUrl, {
          sleep: () => Promise.resolve(),
        })

        // When: search exhausts the transient policy
        const action = client.searchReleases("Hell Mode")

        // Then: exactly two requests produce typed exhaustion
        await expect(action).rejects.toBeInstanceOf(AniLibertyTransientError)
        expect(requests).toBe(2)
      },
    )
  },
)

test.each([400, 401, 403, 404] as const)("does not retry permanent status %i", async (status) => {
  // Given: a real endpoint with a permanent response
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return new Response("unsafe body", { status })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)

      // When: search classifies the permanent response
      const action = client.searchReleases("Hell Mode")

      // Then: the first request fails with the typed HTTP error
      await expect(action).rejects.toBeInstanceOf(AniLibertyHttpError)
      expect(requests).toBe(1)
    },
  )
})

test("maps caller abort while a wire response is streaming", async () => {
  // Given: a live request whose caller aborts as soon as headers arrive
  const controller = new AbortController()
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return streamingJsonResponse(200)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init)
          queueMicrotask(() => controller.abort())
          return response
        },
      })

      // When: search is aborted during wire consumption
      const action = client.searchReleases("Hell Mode", controller.signal)

      // Then: cancellation is typed and no retry occurs
      await expect(action).rejects.toBeInstanceOf(AniLibertyAbortedError)
      expect(requests).toBe(1)
    },
  )
})

test("maps caller abort during retry delay without a second request", async () => {
  // Given: a transient wire response and a caller cancelled by the retry sleeper
  const controller = new AbortController()
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return new Response(null, { headers: { "retry-after": "1" }, status: 503 })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        sleep: (milliseconds, signal) => {
          controller.abort()
          return sleep(milliseconds, signal)
        },
      })

      // When: cancellation arrives during the bounded retry delay
      const action = client.searchReleases("Hell Mode", controller.signal)

      // Then: delay cancellation is typed and retry never starts
      await expect(action).rejects.toBeInstanceOf(AniLibertyAbortedError)
      expect(requests).toBe(1)
    },
  )
})

test("keeps HTTP classification when body cancellation rejects", async () => {
  // Given: an unparsed permanent response whose stream cancellation fails
  const response = new Response(
    new ReadableStream({
      cancel() {
        throw new UnsafePolicyError(unsafeFailure)
      },
    }),
    { status: 404 },
  )
  const client = createTestAniLibertyClient(new URL("http://127.0.0.1/api/v1/"), {
    fetch: () => Promise.resolve(response),
  })

  // When: the permanent response is disposed and classified
  const error = await captureClientError(client.searchReleases("Hell Mode"))

  // Then: disposal stays best-effort and cannot leak its raw failure
  expect(error).toBeInstanceOf(AniLibertyHttpError)
  expect(JSON.stringify(error)).not.toContain(unsafeFailure)
})

test("maps unsafe transport rejection without retaining raw context", async () => {
  // Given: an injected transport that rejects with unsafe request context
  let requests = 0
  const client = createTestAniLibertyClient(new URL("http://127.0.0.1/api/v1/"), {
    fetch: () => {
      requests += 1
      return Promise.reject(new UnsafePolicyError(unsafeFailure))
    },
  })

  // When: search reaches the rejecting transport
  const error = await captureClientError(client.searchReleases("Hell Mode"))

  // Then: the safe transport error has no cause or request leakage
  expect(error).toBeInstanceOf(AniLibertyTransportError)
  expect(JSON.stringify(error)).not.toContain(unsafeFailure)
  expect(error.cause).toBeUndefined()
  expect(requests).toBe(1)
})
