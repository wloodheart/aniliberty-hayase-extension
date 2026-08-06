const ALTERNATIVE_SEPARATOR = /[,;/|]+/u
const LATIN_LETTER = /\p{Script=Latin}/u
const LETTER = /\p{L}/u
const LATIN_LETTERS = /\p{Script=Latin}/gu
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]+/gu
const WHITESPACE = /\s+/gu

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(PUNCTUATION_OR_SYMBOL, " ")
    .replace(WHITESPACE, " ")
    .trim()
}

export function splitAlternativeNames(value: string): readonly string[] {
  const names: string[] = []
  const normalizedNames = new Set<string>()

  for (const part of value.split(ALTERNATIVE_SEPARATOR)) {
    const name = part.trim()
    const normalizedName = normalizeTitle(name)

    if (normalizedName.length === 0 || normalizedNames.has(normalizedName)) continue

    normalizedNames.add(normalizedName)
    names.push(name)
  }

  return names
}

function isLatinScript(value: string): boolean {
  return LATIN_LETTER.test(value) && !LETTER.test(value.replace(LATIN_LETTERS, ""))
}

export function selectSearchTitles(values: readonly string[]): readonly string[] {
  const titles: string[] = []
  const normalizedTitles = new Set<string>()

  for (const value of values) {
    const title = value.trim()
    const normalizedTitle = normalizeTitle(title)

    if (
      Array.from(normalizedTitle.replaceAll(" ", "")).length < 4 ||
      normalizedTitle.length === 0 ||
      normalizedTitles.has(normalizedTitle) ||
      !isLatinScript(title)
    ) {
      continue
    }

    normalizedTitles.add(normalizedTitle)
    titles.push(title)

    if (titles.length === 3) break
  }

  return titles
}
