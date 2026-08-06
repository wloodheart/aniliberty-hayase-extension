import { expect, test } from "bun:test"

import { PromiseLruCache } from "../../src/discovery/cache.ts"

test("coalesces an in-flight loader and retains its successful value", async () => {
  // Given: a loader held by a deterministic deferred promise
  const deferred = Promise.withResolvers<number>()
  let loads = 0
  const cache = new PromiseLruCache<string, number>({
    maxEntries: 64,
    now: () => 0,
    ttlMilliseconds: 60_000,
  })
  const load = (): Promise<number> => {
    loads += 1
    return deferred.promise
  }

  // When: two callers request the key before the loader settles
  const first = cache.getOrLoad("media", load)
  const second = cache.getOrLoad("media", load)
  deferred.resolve(7)

  // Then: one promise does the work and the successful value remains cached
  expect(await Promise.all([first, second])).toEqual([7, 7])
  expect(await cache.getOrLoad("media", load)).toBe(7)
  expect(loads).toBe(1)
})

test("expires at exactly sixty seconds without refreshing TTL on access", async () => {
  // Given: a successful entry and an injected clock
  let now = 0
  let loads = 0
  const cache = new PromiseLruCache<string, number>({
    maxEntries: 64,
    now: () => now,
    ttlMilliseconds: 60_000,
  })
  const load = (): Promise<number> => Promise.resolve(++loads)

  // When: the entry is accessed before and exactly at its expiry boundary
  expect(await cache.getOrLoad("media", load)).toBe(1)
  now = 59_999
  expect(await cache.getOrLoad("media", load)).toBe(1)
  now = 60_000

  // Then: the boundary access reloads instead of extending the original TTL
  expect(await cache.getOrLoad("media", load)).toBe(2)
})

test("touches LRU order on hit while enforcing the sixty-four-entry limit", async () => {
  // Given: a full cache whose first key is touched most recently
  let loads = 0
  const cache = new PromiseLruCache<number, number>({
    maxEntries: 64,
    now: () => 0,
    ttlMilliseconds: 60_000,
  })
  const load = (value: number): Promise<number> => {
    loads += 1
    return Promise.resolve(value)
  }
  await Promise.all(Array.from({ length: 64 }, (_, key) => cache.getOrLoad(key, () => load(key))))
  await cache.getOrLoad(0, () => load(0))

  // When: a sixty-fifth entry is added
  await cache.getOrLoad(64, () => load(64))
  await cache.getOrLoad(0, () => load(0))
  await cache.getOrLoad(1, () => load(1))

  // Then: the untouched second key was evicted and the touched first key survived
  expect(loads).toBe(66)
})

test("removes a rejected promise so the next caller retries", async () => {
  // Given: a loader that fails once and then succeeds
  let loads = 0
  const cache = new PromiseLruCache<string, number>({
    maxEntries: 64,
    now: () => 0,
    ttlMilliseconds: 60_000,
  })
  const load = (): Promise<number> => {
    loads += 1
    return loads === 1 ? Promise.reject(new TypeError("synthetic failure")) : Promise.resolve(9)
  }

  // When: the first call rejects and a later call retries
  const failedWithTypeError = await cache.getOrLoad("media", load).then(
    () => false,
    (error: unknown) => error instanceof TypeError,
  )
  expect(failedWithTypeError).toBe(true)

  // Then: the failure did not poison the cache
  expect(await cache.getOrLoad("media", load)).toBe(9)
  expect(loads).toBe(2)
})
