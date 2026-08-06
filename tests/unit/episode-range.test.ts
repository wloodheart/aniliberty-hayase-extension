import { expect, test } from "bun:test"

import { coversEpisode, parseEpisodeCoverage } from "../../src/matching/episode-range.ts"

test.each([
  ["5", { kind: "coverage", start: 5, end: 5 }],
  ["1-5", { kind: "coverage", start: 1, end: 5 }],
  ["01–12", { kind: "coverage", start: 1, end: 12 }],
  ["12.5", { kind: "coverage", start: 12.5, end: 12.5 }],
  ["1.5—3.5", { kind: "coverage", start: 1.5, end: 3.5 }],
  ["Episodes [1-5] AVC", { kind: "coverage", start: 1, end: 5 }],
] as const)("parses primary episode coverage from %s", (description, expected) => {
  // Given: a supported primary episode description
  // When: coverage is parsed
  const coverage = parseEpisodeCoverage(description)

  // Then: a closed numeric range is returned
  expect(coverage).toEqual(expected)
})

test("keeps primary coverage while ignoring an OVA suffix", () => {
  // Given: primary episodes followed by a separate OVA range
  const description = "1-12 + OVA: [1-4]"

  // When: coverage is parsed
  const coverage = parseEpisodeCoverage(description)

  // Then: only the primary range is retained
  expect(coverage).toEqual({ kind: "coverage", start: 1, end: 12 })
})

test.each([
  "OVA(1-4)",
  "OVA [1-4]",
  "OVA: [1-4]",
  "OVA Episodes [1-4]",
  "unknown",
  "5-1",
  "0",
  "[1080p]",
])("treats non-primary or malformed coverage as absent for %s", (description) => {
  // Given: a description that cannot prove primary episode coverage
  // When: coverage is parsed
  const coverage = parseEpisodeCoverage(description)

  // Then: the parser fails closed
  expect(coverage).toEqual({ kind: "none" })
})

test.each(["OVA(1-4)", "OVA [1-4]", "OVA: [1-4]", "OVA Episodes [1-4]"])(
  "does not cover a primary episode from OVA-only description %s",
  (description) => {
    // Given: an OVA-labelled range without primary coverage
    // When: a listed OVA episode is checked as primary
    const covered = coversEpisode(description, 2)

    // Then: OVA-only metadata fails closed
    expect(covered).toBe(false)
  },
)

test("rejects episode six when the primary range ends at five", () => {
  // Given: a torrent covering episodes one through five
  // When: episode six is checked
  const covered = coversEpisode("1-5", 6)

  // Then: the request is not covered
  expect(covered).toBe(false)
})

test.each([
  ["1-5", 5, true],
  ["1.5-3.5", 2.5, true],
  ["OVA(1-4)", 2, false],
  ["1-5", Number.NaN, false],
] as const)("reports deterministic coverage for %s at %s", (description, episode, expected) => {
  // Given: a description and requested episode
  // When: coverage is checked repeatedly
  const results = Array.from({ length: 25 }, () => coversEpisode(description, episode))

  // Then: every pure evaluation has the same result
  expect(results).toEqual(Array.from({ length: 25 }, () => expected))
})
