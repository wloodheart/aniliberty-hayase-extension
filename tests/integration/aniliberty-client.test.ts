import { expect, test } from "bun:test"

import {
  AniLibertyApiValidationError,
  AniLibertyClientError,
  AniLibertyContentTypeError,
  AniLibertyContractError,
  AniLibertyHttpError,
  AniLibertyMalformedJsonError,
} from "../../src/aniliberty/errors.ts"
import { InfoHashSchema, ReleaseIdSchema } from "../../src/aniliberty/schemas.ts"
import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import { createTestAniLibertyClient } from "../helpers/aniliberty-test-client.ts"

const searchBody = await Bun.file("tests/fixtures/aniliberty/search-hell-mode-s1.json").text()
const torrentBody = await Bun.file("tests/fixtures/aniliberty/torrents-hell-mode-s1.json").text()
const statusBody = await Bun.file("tests/fixtures/aniliberty/status.json").text()
const validationBody = await Bun.file("tests/fixtures/aniliberty/error-422.json").text()
const secretBody = "Synthetic WAF response body"

class MissingClientError extends Error {
  readonly name = "MissingClientError"
}

async function captureClientError(action: Promise<unknown>): Promise<AniLibertyClientError> {
  try {
    await action
  } catch (error) {
    if (error instanceof AniLibertyClientError) {
      return error
    }
    throw error
  }
  throw new MissingClientError("Expected AniLiberty client failure")
}

test("health uses the health fetch and parses the exact status path", async () => {
  // Given: a local status endpoint and a discovery fetch that must remain unused
  await withAniLibertyServer(
    (request) => {
      expect(new URL(request.url).pathname).toBe("/api/v1/app/status")
      return jsonResponse(statusBody)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: () => Promise.reject(new MissingClientError("Discovery fetch used by health")),
      })

      // When: health is requested without a Hayase query fetch
      const status = await client.health()

      // Then: the status schema strips unconsumed request metadata
      expect(status).toEqual({
        available_api_endpoints: ["https://aniliberty.top"],
        is_alive: true,
      })
    },
  )
})

test("search uses injected fetch and preserves encoded query semantics", async () => {
  // Given: a real endpoint observing both raw and decoded query forms
  let injectedCalls = 0
  await withAniLibertyServer(
    (request) => {
      const url = new URL(request.url)
      expect(url.pathname).toBe("/api/v1/app/search/releases")
      expect(url.search).toBe("?query=Hell+Mode")
      expect(url.searchParams.get("query")).toBe("Hell Mode")
      return jsonResponse(searchBody)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl, {
        fetch: (input, init) => {
          injectedCalls += 1
          return globalThis.fetch(input, init)
        },
      })

      // When: a spaced title crosses the search boundary
      const releases = await client.searchReleases("Hell Mode")

      // Then: one branded release is returned through the injected transport
      expect(releases[0]?.id).toBe(ReleaseIdSchema.parse(10096))
      expect(injectedCalls).toBe(1)
    },
  )
})

test("release torrents use only the exact release endpoint", async () => {
  // Given: a real release-torrent endpoint
  await withAniLibertyServer(
    (request) => {
      const url = new URL(request.url)
      expect(url.pathname).toBe("/api/v1/anime/torrents/release/10096")
      expect(url.search).toBe("")
      return jsonResponse(torrentBody)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)

      // When: torrents are requested with a branded release ID
      const torrents = await client.releaseTorrents(ReleaseIdSchema.parse(10096))

      // Then: the Task 3 torrent boundary returns its reduced record
      expect(torrents[0]?.hash).toBe(
        InfoHashSchema.parse("1111111111111111111111111111111111111111"),
      )
      expect(torrents[0]).not.toHaveProperty("release")
    },
  )
})

test.each([
  [403, AniLibertyHttpError],
  [404, AniLibertyHttpError],
] as const)("rejects HTML status %i before JSON parsing", async (status, ErrorType) => {
  // Given: an HTML error response that contains unsafe body text
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return new Response(`<html>${secretBody}</html>`, {
        headers: { "content-type": "text/html" },
        status,
      })
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)

      // When: the permanent response is classified
      const error = await captureClientError(client.searchReleases("Hell Mode"))

      // Then: it is not retried and no unsafe request/body value is exposed
      expect(error).toBeInstanceOf(ErrorType)
      expect(requests).toBe(1)
      expect(JSON.stringify(error)).not.toContain("Hell Mode")
      expect(`${error.name}: ${error.message}`).not.toContain(secretBody)
    },
  )
})

test("parses JSON 422 as a permanent API validation error", async () => {
  // Given: a valid validation response from the API
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return jsonResponse(validationBody, 422)
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)

      // When: search receives validation status
      const error = await captureClientError(client.searchReleases("Hell Mode"))

      // Then: the typed permanent error contains neither query nor response details
      expect(error).toBeInstanceOf(AniLibertyApiValidationError)
      expect(requests).toBe(1)
      expect(JSON.stringify(error)).not.toContain("Hell Mode")
      expect(JSON.stringify(error)).not.toContain("Synthetic validation failure")
    },
  )
})

test.each([
  ["malformed JSON", jsonResponse("{"), AniLibertyMalformedJsonError],
  ["wrong content type", new Response(searchBody, { status: 200 }), AniLibertyContentTypeError],
  ["schema drift", jsonResponse("{}"), AniLibertyContractError],
] as const)("distinguishes %s success failures", async (_case, response, ErrorType) => {
  // Given: a 200 response that violates one boundary layer
  let requests = 0
  await withAniLibertyServer(
    () => {
      requests += 1
      return response.clone()
    },
    async (baseUrl) => {
      const client = createTestAniLibertyClient(baseUrl)

      // When: the success response is processed
      const error = await captureClientError(client.searchReleases("Hell Mode"))

      // Then: its precise typed boundary error is returned without query leakage
      expect(error).toBeInstanceOf(ErrorType)
      expect(JSON.stringify(error)).not.toContain("Hell Mode")
      expect(requests).toBe(1)
    },
  )
})
