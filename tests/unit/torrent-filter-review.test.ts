import { expect, test } from "bun:test"

import { InfoHashSchema } from "../../src/aniliberty/schemas.ts"
import { filterTorrents } from "../../src/discovery/torrent-filter.ts"
import {
  baseDiscoveryRequest,
  seasonOneRelease,
  seasonOneTorrent,
  seasonTwoRelease,
  seasonTwoTorrent,
  torrentWith,
} from "../helpers/discovery-fixtures.ts"

const matchingV1Topic = `urn:btih:${seasonOneTorrent.hash}`
const conflictingV1Topic = "urn:btih:3333333333333333333333333333333333333333"

test.each([
  [matchingV1Topic, conflictingV1Topic],
  [conflictingV1Topic, matchingV1Topic],
] as const)("rejects conflicting repeated identities in either topic order", (first, second) => {
  // Given: a magnet with matching and conflicting recognized identities
  const torrent = torrentWith(seasonOneTorrent, {
    magnet: `magnet:?xt=${first}&xt=${second}`,
  })

  // When: every exact-topic value is inspected
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [torrent] },
    baseDiscoveryRequest,
  )

  // Then: topic order cannot select an identity
  expect(results).toEqual([])
})

test.each(["urn:btih:not-a-digest", "urn:unsupported:identity"])(
  "rejects an ambiguous repeated topic %s",
  (ambiguousTopic) => {
    // Given: a valid first identity followed by an unsupported or malformed identity
    const torrent = torrentWith(seasonOneTorrent, {
      magnet: `magnet:?xt=${matchingV1Topic}&xt=${ambiguousTopic}`,
    })

    // When: repeated identities are checked
    const results = filterTorrents(
      { release: seasonOneRelease, torrents: [torrent] },
      baseDiscoveryRequest,
    )

    // Then: ambiguous identity evidence fails closed
    expect(results).toEqual([])
  },
)

test("accepts duplicate identical topics and valid single-topic v1 and v2 magnets", () => {
  // Given: valid v1, repeated identical v1, and valid v2 identity evidence
  const duplicateV1 = torrentWith(seasonOneTorrent, {
    magnet: `magnet:?xt=${matchingV1Topic}&xt=${matchingV1Topic}`,
  })
  const alphabeticHash = InfoHashSchema.parse("abcdefabcdefabcdefabcdefabcdefabcdefabcd")
  const caseVariantV1 = torrentWith(seasonOneTorrent, {
    hash: alphabeticHash,
    magnet: `magnet:?xt=urn:btih:${alphabeticHash.toUpperCase()}`,
  })

  // When: each supported identity form is filtered
  const singleV1 = filterTorrents(
    { release: seasonOneRelease, torrents: [seasonOneTorrent] },
    baseDiscoveryRequest,
  )
  const repeatedV1 = filterTorrents(
    { release: seasonOneRelease, torrents: [duplicateV1] },
    baseDiscoveryRequest,
  )
  const caseVariant = filterTorrents(
    { release: seasonOneRelease, torrents: [caseVariantV1] },
    baseDiscoveryRequest,
  )
  const singleV2 = filterTorrents(
    { release: seasonTwoRelease, torrents: [seasonTwoTorrent] },
    { ...baseDiscoveryRequest, episode: 5, episodeCount: null },
  )

  // Then: every unambiguous supported identity remains eligible
  expect(singleV1).toHaveLength(1)
  expect(repeatedV1).toHaveLength(1)
  expect(caseVariant).toHaveLength(1)
  expect(singleV2).toHaveLength(1)
})

test.each([" HEVC ", "\tHEVC\n"])("trims padded exclusion %j", (exclusion) => {
  // Given: HEVC metadata and a whitespace-padded exclusion
  const torrent = torrentWith(seasonOneTorrent, {
    codec: { ...seasonOneTorrent.codec, label: "HEVC" },
  })

  // When: normalized exclusion filtering runs
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [torrent] },
    { ...baseDiscoveryRequest, exclusions: [exclusion] },
  )

  // Then: padding cannot prevent the exclusion
  expect(results).toEqual([])
})

test("keeps empty and whitespace-only exclusions inert", () => {
  // Given: exclusions with no normalized content
  const request = { ...baseDiscoveryRequest, exclusions: ["", " \t\n "] }

  // When: exclusion filtering runs
  const results = filterTorrents(
    { release: seasonOneRelease, torrents: [seasonOneTorrent] },
    request,
  )

  // Then: the valid torrent remains eligible
  expect(results).toHaveLength(1)
})
