import { normalizeTitle, selectSearchTitles, splitAlternativeNames } from "./normalize.ts"
import { areSeasonTitlesEquivalent, haveSeasonTitleConflict, parseSeasonTitle } from "./season.ts"

export type MatchScore = 100 | 90 | 80
export type MatchMode = "series" | "movie"

export type ReleaseMatchQuery = {
  readonly titles: readonly string[]
  readonly startYear: number | null
  readonly episodeCount: number | null
  readonly requestedEpisode: number
  readonly mode: MatchMode
}

export type ReleaseCandidate = {
  readonly id: number
  readonly mainTitle: string
  readonly englishTitle: string
  readonly alternativeTitles: string
  readonly startYear: number | null
  readonly mediaKind: MatchMode
  readonly episodesTotal: number | null
  readonly isCompleted: boolean
  readonly isBlockedByGeo: boolean
  readonly isBlockedByCopyrights: boolean
}

export type ReleaseMatchResult =
  | {
      readonly kind: "match"
      readonly candidate: ReleaseCandidate
      readonly score: MatchScore
    }
  | {
      readonly kind: "none"
      readonly reason: "no_eligible_candidate" | "ambiguous"
    }

type MatchTitles = {
  readonly query: readonly string[]
  readonly release: readonly string[]
}

const MIN_BOUNDARY_CONTEXT_TOKENS = 4

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0
}

function isValidOptionalPositiveInteger(value: number | null): boolean {
  return value === null || isPositiveInteger(value)
}

function significantTokens(title: string): ReadonlySet<string> {
  return new Set(title.split(" ").filter((token) => token.length >= 2))
}

function containmentScore(left: string, right: string): MatchScore | null {
  const leftTokens = significantTokens(parseSeasonTitle(left).baseTitle)
  const rightTokens = significantTokens(parseSeasonTitle(right).baseTitle)

  if (leftTokens.size < 2 || rightTokens.size < 2) return null

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.9 ? 80 : null
}

function boundaryPlacementScore(left: string, right: string): MatchScore | null {
  const leftTitle = parseSeasonTitle(left)
  const rightTitle = parseSeasonTitle(right)
  const leftSeason = leftTitle.kind === "season" ? leftTitle.ordinal : 1
  const rightSeason = rightTitle.kind === "season" ? rightTitle.ordinal : 1

  if (
    leftSeason !== rightSeason ||
    leftTitle.baseTitle.replaceAll(" ", "") !== rightTitle.baseTitle.replaceAll(" ", "")
  ) {
    return null
  }

  const rightTokens = significantTokens(rightTitle.baseTitle)
  let unchangedTokens = 0

  for (const token of significantTokens(leftTitle.baseTitle)) {
    if (rightTokens.has(token)) unchangedTokens += 1
  }

  return unchangedTokens >= MIN_BOUNDARY_CONTEXT_TOKENS ? 80 : null
}

export function scoreTitleMatch(queryTitle: string, candidateTitle: string): MatchScore | null {
  const normalizedQuery = normalizeTitle(queryTitle)
  const normalizedCandidate = normalizeTitle(candidateTitle)

  if (normalizedQuery.length === 0 || normalizedCandidate.length === 0) return null
  if (normalizedQuery === normalizedCandidate) return 100
  if (haveSeasonTitleConflict(queryTitle, candidateTitle)) return null
  if (areSeasonTitlesEquivalent(queryTitle, candidateTitle)) return 90

  return (
    boundaryPlacementScore(queryTitle, candidateTitle) ??
    containmentScore(queryTitle, candidateTitle)
  )
}

function candidateTitles(candidate: ReleaseCandidate): readonly string[] {
  return [
    candidate.mainTitle,
    candidate.englishTitle,
    ...splitAlternativeNames(candidate.alternativeTitles),
  ].filter((title) => normalizeTitle(title).length > 0)
}

function seasonOrdinal(titles: readonly string[]): number | null {
  let explicitOrdinal: number | null = null

  for (const title of titles) {
    const parsed = parseSeasonTitle(title)
    if (parsed.kind === "base") continue
    if (explicitOrdinal !== null && explicitOrdinal !== parsed.ordinal) return null
    explicitOrdinal = parsed.ordinal
  }

  return explicitOrdinal ?? 1
}

function hasHardConflict(
  query: ReleaseMatchQuery,
  candidate: ReleaseCandidate,
  titles: MatchTitles,
): boolean {
  const querySeason = seasonOrdinal(titles.query)
  const candidateSeason = seasonOrdinal(titles.release)

  return (
    !isValidOptionalPositiveInteger(candidate.startYear) ||
    !isValidOptionalPositiveInteger(candidate.episodesTotal) ||
    querySeason === null ||
    candidateSeason === null ||
    querySeason !== candidateSeason ||
    candidate.isBlockedByGeo ||
    candidate.isBlockedByCopyrights ||
    candidate.mediaKind !== query.mode ||
    (query.startYear !== null &&
      candidate.startYear !== null &&
      Math.abs(query.startYear - candidate.startYear) > 1) ||
    (candidate.isCompleted &&
      query.episodeCount !== null &&
      candidate.episodesTotal !== null &&
      query.episodeCount !== candidate.episodesTotal) ||
    (candidate.episodesTotal !== null && query.requestedEpisode > candidate.episodesTotal)
  )
}

function bestTitleScore(
  queryTitles: readonly string[],
  releaseTitles: readonly string[],
): MatchScore | null {
  let best: MatchScore | null = null

  for (const queryTitle of queryTitles) {
    for (const releaseTitle of releaseTitles) {
      const score = scoreTitleMatch(queryTitle, releaseTitle)
      if (score !== null && (best === null || score > best)) best = score
    }
  }

  return best
}

export function matchRelease(
  query: ReleaseMatchQuery,
  candidates: readonly ReleaseCandidate[],
): ReleaseMatchResult {
  const queryTitles = selectSearchTitles(query.titles)

  if (
    queryTitles.length === 0 ||
    !isPositiveInteger(query.requestedEpisode) ||
    !isValidOptionalPositiveInteger(query.startYear) ||
    !isValidOptionalPositiveInteger(query.episodeCount)
  ) {
    return { kind: "none", reason: "no_eligible_candidate" }
  }

  let winner: ReleaseCandidate | null = null
  let topScore: MatchScore | null = null
  let hasTopScoreTie = false

  for (const candidate of candidates) {
    const releaseTitles = candidateTitles(candidate)
    if (hasHardConflict(query, candidate, { query: queryTitles, release: releaseTitles })) continue

    const score = bestTitleScore(queryTitles, releaseTitles)
    if (score === null) continue

    if (topScore === null || score > topScore) {
      winner = candidate
      topScore = score
      hasTopScoreTie = false
    } else if (score === topScore) {
      hasTopScoreTie = true
    }
  }

  if (hasTopScoreTie) return { kind: "none", reason: "ambiguous" }
  if (winner === null || topScore === null) {
    return { kind: "none", reason: "no_eligible_candidate" }
  }

  return { kind: "match", candidate: winner, score: topScore }
}
