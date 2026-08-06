import { expect, test } from "bun:test"

import { areSeasonTitlesEquivalent, parseSeasonTitle } from "../../src/matching/season.ts"

test.each([
  ["Hell Mode S2", "hell mode", 2],
  ["Hell Mode Season 2", "hell mode", 2],
  ["Hell Mode 2nd Season", "hell mode", 2],
  ["Hell Mode 3rd", "hell mode", 3],
  ["Hell Mode 11th", "hell mode", 11],
] as const)("recognizes a trailing season form in %s", (title, baseTitle, ordinal) => {
  // Given: a title with a supported trailing season marker
  // When: its season is parsed
  const parsed = parseSeasonTitle(title)

  // Then: the base and positive ordinal are explicit
  expect(parsed).toEqual({ kind: "season", title: title.toLowerCase(), baseTitle, ordinal })
})

test.each(["Hell Mode", "Season 2 Hell Mode", "Hell Mode 2024", "Hell Mode S0"])(
  "does not infer an unsupported season from %s",
  (title) => {
    // Given: a title without a supported positive trailing season marker
    // When: its season is parsed
    const parsed = parseSeasonTitle(title)

    // Then: the complete normalized title remains the base
    expect(parsed).toEqual({
      kind: "base",
      title: title.toLowerCase(),
      baseTitle: title.toLowerCase(),
    })
  },
)

test.each([
  ["Hell Mode Season 2", "Hell Mode 2nd Season", true],
  ["Hell Mode", "Hell Mode Season 1", true],
  ["Hell Mode", "Hell Mode S2", false],
  ["Hell Mode S2", "Hell Mode S3", false],
  ["Hell Mode S2", "Another Mode S2", false],
] as const)("compares season-equivalent titles conservatively", (left, right, expected) => {
  // Given: two normalized title forms
  // When: recognized season suffixes are compared
  const equivalent = areSeasonTitlesEquivalent(left, right)

  // Then: only equal bases with equal effective ordinals match
  expect(equivalent).toBe(expected)
})
