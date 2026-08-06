import { expect, test } from "bun:test"

import type { SearchRelease } from "../../src/aniliberty/schemas.ts"
import { type DiscoveryClient, DiscoveryService } from "../../src/discovery/discover.ts"
import {
  baseDiscoveryRequest,
  releaseWith,
  seasonOneRelease,
  seasonOneTorrent,
} from "../helpers/discovery-fixtures.ts"

class ReviewClient implements DiscoveryClient {
  torrentRequests = 0

  constructor(private readonly releases: readonly SearchRelease[]) {}

  searchReleases(): Promise<readonly SearchRelease[]> {
    return Promise.resolve(this.releases)
  }

  releaseTorrents(): Promise<readonly unknown[]> {
    this.torrentRequests += 1
    return Promise.resolve([seasonOneTorrent])
  }
}

const matchingFieldConflicts = [
  ["type", { type: { value: "MOVIE" } }],
  ["year", { year: 2024 }],
  ["main name", { name: { ...seasonOneRelease.name, main: "Conflicting Main" } }],
  ["English name", { name: { ...seasonOneRelease.name, english: "Conflicting English" } }],
  ["alternative name", { name: { ...seasonOneRelease.name, alternative: "Conflict" } }],
  ["season", { season: { value: "spring" } }],
  ["episode total", { episodes_total: 13 }],
  ["geo block", { is_blocked_by_geo: true }],
  ["copyright block", { is_blocked_by_copyrights: true }],
] satisfies readonly (readonly [string, Partial<SearchRelease>])[]

test.each(matchingFieldConflicts)(
  "quarantines duplicate release IDs with conflicting %s in either order",
  async (_field, changes) => {
    // Given: two payloads for one branded ID that disagree on a consumed matching field
    const conflicting = releaseWith(seasonOneRelease, changes)
    const forwardClient = new ReviewClient([seasonOneRelease, conflicting, seasonOneRelease])
    const reverseClient = new ReviewClient([conflicting, seasonOneRelease, conflicting])

    // When: each payload order is discovered independently
    const [forward, reverse] = await Promise.all([
      new DiscoveryService(forwardClient, () => 0).discover(baseDiscoveryRequest),
      new DiscoveryService(reverseClient, () => 0).discover(baseDiscoveryRequest),
    ])

    // Then: the conflicted ID cannot participate in matching or torrent fetching
    expect(forward).toEqual([])
    expect(reverse).toEqual([])
    expect(forwardClient.torrentRequests).toBe(0)
    expect(reverseClient.torrentRequests).toBe(0)
  },
)

test("keeps identical duplicate release payloads eligible", async () => {
  // Given: byte-equivalent consumed payloads for one branded release ID
  const client = new ReviewClient([seasonOneRelease, { ...seasonOneRelease }])

  // When: discovery deduplicates the payloads
  const results = await new DiscoveryService(client, () => 0).discover(baseDiscoveryRequest)

  // Then: one eligible release produces one torrent fetch
  expect(results).toHaveLength(1)
  expect(client.torrentRequests).toBe(1)
})

test("treats a known episode total as ongoing without explicit completion evidence", async () => {
  // Given: a matching release with a known total different from the query count
  const ongoing = releaseWith(seasonOneRelease, { episodes_total: 13 })
  const client = new ReviewClient([ongoing])

  // When: discovery maps the schema-owned release into the conservative matcher
  const results = await new DiscoveryService(client, () => 0).discover(baseDiscoveryRequest)

  // Then: completed-only count conflict is not inferred from episodes_total
  expect(results).toHaveLength(1)
  expect(client.torrentRequests).toBe(1)
})
