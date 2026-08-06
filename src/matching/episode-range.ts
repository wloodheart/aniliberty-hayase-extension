export type EpisodeCoverage =
  | {
      readonly kind: "coverage"
      readonly start: number
      readonly end: number
    }
  | { readonly kind: "none" }

const PRIMARY_COVERAGE =
  /^\s*(\d+(?:\.\d+)?)(?:\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?))?(?=$|[\s+;,([])/u
const BRACKETED_RANGE = /[[(]\s*(\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)\s*[\])]/u
const OVA_LABEL = /\bova\b/iu

function coverageFromMatch(match: RegExpExecArray | null): EpisodeCoverage {
  const startText = match?.[1]
  const endText = match?.[2] ?? startText

  if (startText === undefined || endText === undefined) return { kind: "none" }

  const start = Number(startText)
  const end = Number(endText)

  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
    return { kind: "none" }
  }

  return { kind: "coverage", start, end }
}

export function parseEpisodeCoverage(description: string): EpisodeCoverage {
  const normalizedDescription = description.normalize("NFKC")
  const primary = coverageFromMatch(PRIMARY_COVERAGE.exec(normalizedDescription))

  if (primary.kind === "coverage") return primary
  if (OVA_LABEL.test(normalizedDescription)) return { kind: "none" }

  return coverageFromMatch(BRACKETED_RANGE.exec(normalizedDescription))
}

export function coversEpisode(description: string, episode: number): boolean {
  if (!Number.isFinite(episode) || episode <= 0) return false

  const coverage = parseEpisodeCoverage(description)

  switch (coverage.kind) {
    case "coverage":
      return episode >= coverage.start && episode <= coverage.end
    case "none":
      return false
  }
}
