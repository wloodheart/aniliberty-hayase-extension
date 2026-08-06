import { normalizeTitle } from "./normalize.ts"

export type ParsedSeasonTitle =
  | {
      readonly kind: "base"
      readonly title: string
      readonly baseTitle: string
    }
  | {
      readonly kind: "season"
      readonly title: string
      readonly baseTitle: string
      readonly ordinal: number
    }

const SEASON_SUFFIXES = [
  /^(.*?)\s+s(\d+)$/u,
  /^(.*?)\s+season\s+(\d+)$/u,
  /^(.*?)\s+(\d+)(?:st|nd|rd|th)\s+season$/u,
  /^(.*?)\s+(\d+)(?:st|nd|rd|th)$/u,
] as const

export function parseSeasonTitle(value: string): ParsedSeasonTitle {
  const title = normalizeTitle(value)

  for (const suffix of SEASON_SUFFIXES) {
    const match = suffix.exec(title)
    const baseTitle = match?.[1]?.trim()
    const ordinalText = match?.[2]

    if (baseTitle === undefined || baseTitle.length === 0 || ordinalText === undefined) continue

    const ordinal = Number(ordinalText)
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) continue

    return { kind: "season", title, baseTitle, ordinal }
  }

  return { kind: "base", title, baseTitle: title }
}

function effectiveOrdinal(title: ParsedSeasonTitle): number {
  switch (title.kind) {
    case "base":
      return 1
    case "season":
      return title.ordinal
  }
}

export function areSeasonTitlesEquivalent(left: string, right: string): boolean {
  const leftTitle = parseSeasonTitle(left)
  const rightTitle = parseSeasonTitle(right)

  return (
    leftTitle.baseTitle === rightTitle.baseTitle &&
    effectiveOrdinal(leftTitle) === effectiveOrdinal(rightTitle)
  )
}

export function haveSeasonTitleConflict(left: string, right: string): boolean {
  const leftTitle = parseSeasonTitle(left)
  const rightTitle = parseSeasonTitle(right)

  return (
    leftTitle.baseTitle === rightTitle.baseTitle &&
    effectiveOrdinal(leftTitle) !== effectiveOrdinal(rightTitle)
  )
}
