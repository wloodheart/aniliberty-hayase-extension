import { expect, test } from "bun:test"

import {
  normalizeTitle,
  selectSearchTitles,
  splitAlternativeNames,
} from "../../src/matching/normalize.ts"

test("normalizes compatibility characters, case, punctuation, and whitespace", () => {
  // Given: equivalent title text containing full-width forms and punctuation
  const title = "  ＨＥＬＬ—Mode: 2ND   Season!!  "

  // When: the title is normalized
  const normalized = normalizeTitle(title)

  // Then: normalization is locale-independent and comparison-ready
  expect(normalized).toBe("hell mode 2nd season")
})

test("splits alternative names in source order and removes normalized duplicates", () => {
  // Given: the comma-separated API form plus tolerated deterministic delimiters
  const alternatives = "Hell Mode, Hell-Mode / Hardcore Gamer; HELL MODE | Another Name"

  // When: alternative names are split
  const names = splitAlternativeNames(alternatives)

  // Then: first occurrence wins and empty/duplicate values are omitted
  expect(names).toEqual(["Hell Mode", "Hardcore Gamer", "Another Name"])
})

test("selects at most three distinct Latin-script titles in preference order", () => {
  // Given: Hayase-ordered titles with invalid scripts, short values, and duplicates
  const titles = [
    "Адский режим",
    "Hell Mode",
    "hell-mode",
    "地獄モード",
    "abc",
    "Hardcore Gamer",
    "Mode infernal",
    "Fourth Valid Title",
  ]

  // When: search titles are selected
  const selected = selectSearchTitles(titles)

  // Then: valid first occurrences are preserved and the search fan-out is capped
  expect(selected).toEqual(["Hell Mode", "Hardcore Gamer", "Mode infernal"])
})

test.each(["!!!A", "A-B-C"])("rejects %s below the normalized meaningful title floor", (title) => {
  // Given: punctuation-padded Latin text with fewer than four meaningful characters
  // When: search titles are selected
  const selected = selectSearchTitles([title])

  // Then: punctuation and spaces cannot satisfy the safety floor
  expect(selected).toEqual([])
})

test("returns fresh deterministic values for malformed and repeated inputs", () => {
  // Given: an input containing only blanks and one valid title
  const titles = ["", "   ", "Hell Mode"]

  // When: selection is repeated
  const runs = Array.from({ length: 25 }, () => selectSearchTitles(titles))

  // Then: no stale state leaks between calls
  expect(runs.slice(1).every((run) => run !== runs[0])).toBe(true)
  expect(runs).toEqual(Array.from({ length: 25 }, () => ["Hell Mode"]))
})
