import { expect, test } from "bun:test"

import {
  matchRelease,
  type ReleaseCandidate,
  type ReleaseMatchQuery,
  scoreTitleMatch,
} from "../../src/matching/release-matcher.ts"

const baseQuery = {
  titles: ["Hell Mode"],
  startYear: 2025,
  episodeCount: 12,
  requestedEpisode: 6,
  mode: "series",
} satisfies ReleaseMatchQuery

function release(
  id: number,
  englishTitle: string,
  overrides: Partial<ReleaseCandidate> = {},
): ReleaseCandidate {
  return {
    id,
    mainTitle: "Адский режим",
    englishTitle,
    alternativeTitles: "",
    startYear: 2025,
    mediaKind: "series",
    episodesTotal: 12,
    isCompleted: true,
    isBlockedByGeo: false,
    isBlockedByCopyrights: false,
    ...overrides,
  }
}

test.each([
  ["Hell Mode", "ＨＥＬＬ—MODE", 100],
  ["Hell Mode Season 2", "Hell Mode 2nd Season", 90],
  [
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
    "alpha bravo charlie delta echo foxtrot golf hotel india",
    80,
  ],
] as const)("scores %s against %s conservatively", (queryTitle, candidateTitle, expected) => {
  // Given: two title forms at a documented score boundary
  // When: title similarity is scored
  const score = scoreTitleMatch(queryTitle, candidateTitle)

  // Then: only the documented score is returned
  expect(score).toBe(expected)
})

test.each([
  [
    "alpha bravo charlie delta echo foxtrot golf hotel india",
    "alpha bravo charlie delta echo foxtrot golf hotel",
  ],
  ["alpha x", "alpha y"],
  ["Hell Mode S2", "Hell Mode S3"],
] as const)("rejects title similarity below the safe boundary", (queryTitle, candidateTitle) => {
  // Given: a misleading title pair below a documented requirement
  // When: title similarity is scored
  const score = scoreTitleMatch(queryTitle, candidateTitle)

  // Then: no sub-80 score is exposed
  expect(score).toBeNull()
})

test("selects Hell Mode season one for the base query", () => {
  // Given: reduced season-one, season-two, and fuzzy false-positive releases
  const seasonOne = release(10096, "Hell Mode")
  const candidates = [
    seasonOne,
    release(10239, "Hell Mode 2nd Season", { startYear: 2026 }),
    release(6800, "Welcome to Demon School! Iruma-kun", { startYear: 2019 }),
  ]

  // When: the base title is matched
  const result = matchRelease(baseQuery, candidates)

  // Then: the exact first-season release wins
  expect(result).toEqual({ kind: "match", candidate: seasonOne, score: 100 })
})

test("rejects the reduced candidate 6800 false positive on title evidence", () => {
  // Given: candidate 6800 with otherwise eligible local values
  const candidate = release(6800, "Welcome to Demon School! Iruma-kun")

  // When: the Hell Mode query is matched
  const result = matchRelease(baseQuery, [candidate])

  // Then: unrelated fuzzy-search output cannot become a release match
  expect(result).toEqual({ kind: "none", reason: "no_eligible_candidate" })
})

test("matches an exact comma-separated alternative alias", () => {
  // Given: a release whose matching Latin title is only in alternatives
  const candidate = release(1, "Unrelated English Name", {
    alternativeTitles: "Another Alias, Hell Mode",
  })

  // When: the release is matched
  const result = matchRelease(baseQuery, [candidate])

  // Then: the split exact alias receives the exact score
  expect(result).toEqual({ kind: "match", candidate, score: 100 })
})

test("selects Hell Mode season two for an explicit second-season query", () => {
  // Given: both reduced Hell Mode seasons
  const seasonTwo = release(10239, "Hell Mode Season 2", { startYear: 2026 })
  const candidates = [release(10096, "Hell Mode", { startYear: 2025 }), seasonTwo]
  const query = {
    ...baseQuery,
    titles: ["Hell Mode 2nd Season", "Hell Mode S2"],
    startYear: 2026,
  } satisfies ReleaseMatchQuery

  // When: the explicit second season is matched
  const result = matchRelease(query, candidates)

  // Then: the season-equivalent second release wins
  expect(result).toEqual({ kind: "match", candidate: seasonTwo, score: 90 })
})

test.each([
  ["season conflict", baseQuery, release(1, "Hell Mode S2")],
  ["year conflict", baseQuery, release(1, "Hell Mode", { startYear: 2023 })],
  ["movie conflict", baseQuery, release(1, "Hell Mode", { mediaKind: "movie" })],
  ["completed count conflict", baseQuery, release(1, "Hell Mode", { episodesTotal: 13 })],
  ["geo block", baseQuery, release(1, "Hell Mode", { isBlockedByGeo: true })],
  ["copyright block", baseQuery, release(1, "Hell Mode", { isBlockedByCopyrights: true })],
  [
    "requested episode beyond total",
    { ...baseQuery, requestedEpisode: 13 },
    release(1, "Hell Mode"),
  ],
] as const)("rejects an exact title with a %s", (_label, query, candidate) => {
  // Given: an exact title candidate carrying one hard conflict
  // When: release matching runs
  const result = matchRelease(query, [candidate])

  // Then: title success cannot bypass the conflict
  expect(result).toEqual({ kind: "none", reason: "no_eligible_candidate" })
})

test.each([
  ["query start year NaN", { ...baseQuery, startYear: Number.NaN }, release(1, "Hell Mode")],
  ["candidate start year NaN", baseQuery, release(1, "Hell Mode", { startYear: Number.NaN })],
  [
    "candidate start year infinity",
    baseQuery,
    release(1, "Hell Mode", { startYear: Number.POSITIVE_INFINITY }),
  ],
  [
    "query episode count NaN",
    { ...baseQuery, episodeCount: Number.NaN },
    release(1, "Hell Mode", { isCompleted: false }),
  ],
  [
    "candidate episode total NaN",
    baseQuery,
    release(1, "Hell Mode", { episodesTotal: Number.NaN, isCompleted: false }),
  ],
  ["non-positive query year", { ...baseQuery, startYear: 0 }, release(1, "Hell Mode")],
  [
    "fractional candidate episode total",
    baseQuery,
    release(1, "Hell Mode", { episodesTotal: 12.5 }),
  ],
] as const)("rejects invalid numeric metadata for %s", (_label, query, candidate) => {
  // Given: an exact title with invalid non-null conflict metadata
  // When: release matching runs
  const result = matchRelease(query, [candidate])

  // Then: invalid arithmetic inputs cannot bypass hard conflicts
  expect(result).toEqual({ kind: "none", reason: "no_eligible_candidate" })
})

test("preserves unknown nullable year and episode-count metadata", () => {
  // Given: an exact release whose optional numeric metadata is unknown
  const query = { ...baseQuery, startYear: null, episodeCount: null } satisfies ReleaseMatchQuery
  const candidate = release(1, "Hell Mode", { startYear: null, episodesTotal: null })

  // When: release matching runs
  const result = matchRelease(query, [candidate])

  // Then: null remains an allowed unknown rather than malformed metadata
  expect(result).toEqual({ kind: "match", candidate, score: 100 })
})

test.each([
  [{ ...baseQuery, mode: "movie" }, release(1, "Hell Mode", { mediaKind: "series" })],
  [baseQuery, release(1, "Hell Mode", { mediaKind: "movie" })],
] as const)("rejects movie and series mode mismatches", (query, candidate) => {
  // Given: a query and release with opposite media modes
  // When: release matching runs
  const result = matchRelease(query, [candidate])

  // Then: no cross-mode release is selected
  expect(result.kind).toBe("none")
})

test("allows one-year drift and an unfinished episode-count difference", () => {
  // Given: a matching ongoing release one year from the query
  const candidate = release(1, "Hell Mode", {
    startYear: 2024,
    episodesTotal: 13,
    isCompleted: false,
  })

  // When: release matching runs
  const result = matchRelease(baseQuery, [candidate])

  // Then: only completed count differences are hard conflicts
  expect(result).toEqual({ kind: "match", candidate, score: 100 })
})

test("rejects unresolved equal top scores instead of using input order", () => {
  // Given: two equally exact eligible releases
  const candidates = [release(1, "Hell Mode"), release(2, "Hell Mode")]

  // When: release matching runs in either order
  const forward = matchRelease(baseQuery, candidates)
  const reverse = matchRelease(baseQuery, candidates.toReversed())

  // Then: both orders return the same explicit ambiguity
  expect(forward).toEqual({ kind: "none", reason: "ambiguous" })
  expect(reverse).toEqual(forward)
})

test("is pure across malformed and repeated calls", () => {
  // Given: frozen inputs and one malformed empty-title query
  const candidate = Object.freeze(release(1, "Hell Mode"))
  const candidates = Object.freeze([candidate])
  const malformed = { ...baseQuery, titles: ["", " "] } satisfies ReleaseMatchQuery
  const before = JSON.stringify({ baseQuery, candidates })

  // When: valid and invalid matches are interleaved repeatedly
  const results = Array.from({ length: 25 }, () => [
    matchRelease(baseQuery, candidates),
    matchRelease(malformed, candidates),
  ])

  // Then: output is stable and inputs retain no matcher state
  expect(
    results.every(([valid, invalid]) => valid?.kind === "match" && invalid?.kind === "none"),
  ).toBe(true)
  expect(JSON.stringify({ baseQuery, candidates })).toBe(before)
})
