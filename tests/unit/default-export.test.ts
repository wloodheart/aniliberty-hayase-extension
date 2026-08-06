import { afterEach, expect, test } from "bun:test"
import { HayaseTorrentSource } from "../../src/hayase/adapter.ts"
import type { AnimeQueryWithFetch, InjectedFetch } from "../../src/hayase/types.ts"
import * as extensionModule from "../../src/index.ts"

const originalFetch = globalThis.fetch

function invalidQuery(fetch: InjectedFetch): AnimeQueryWithFetch {
  return {
    media: null,
    anilistId: 1,
    titles: [],
    episode: 1,
    resolution: "",
    exclusions: [],
    fetch,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("default exports one instantiated source with callable bound methods", async () => {
  // Given: the extension module and methods extracted from its default object
  let discoveryRequests = 0
  const injectedFetch: InjectedFetch = () => {
    discoveryRequests += 1
    return Promise.resolve(Response.json([]))
  }
  globalThis.fetch = Object.assign(
    () => Promise.resolve(Response.json({ is_alive: true, available_api_endpoints: [] })),
    { preconnect: originalFetch.preconnect },
  )
  const { test: health, single, batch, movie } = extensionModule.default

  // When: the extracted methods are invoked without their owning object
  const results = await Promise.all([
    health(),
    single(invalidQuery(injectedFetch)),
    batch(invalidQuery(injectedFetch)),
    movie(invalidQuery(injectedFetch)),
  ])

  // Then: the default is an instance rather than a constructor and retains method context
  expect(Object.keys(extensionModule)).toEqual(["default"])
  expect(extensionModule.default).toBeInstanceOf(HayaseTorrentSource)
  expect(typeof extensionModule.default).toBe("object")
  expect(typeof health).toBe("function")
  expect(typeof single).toBe("function")
  expect(typeof batch).toBe("function")
  expect(typeof movie).toBe("function")
  expect(results).toEqual([true, [], [], []])
  expect(discoveryRequests).toBe(0)
})
