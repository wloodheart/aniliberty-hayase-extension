export type Accuracy = "high" | "medium" | "low"
type ResultType = "batch" | "best" | "alt"

const ACCURACIES = ["high", "medium", "low"] as const
const ACCURACY_RANK = { high: 0, medium: 1, low: 2 } as const
const QUERY_RULES = {
  anilistId: { setTo: "medium", maxAllowed: "high" },
  anidbAid: { setTo: "medium", maxAllowed: "high" },
  anidbEid: { setTo: "high", maxAllowed: "high" },
  tvdbId: { setTo: "medium", maxAllowed: "high" },
  tvdbEId: { setTo: "high", maxAllowed: "high" },
  imdbId: { setTo: "medium", maxAllowed: "high" },
  tmdbId: { setTo: "medium", maxAllowed: "high" },
  episode: { setTo: "low", maxAllowed: "high" },
  episodeCount: { setTo: "low", maxAllowed: "high" },
  absoluteEpisodeNumber: { setTo: "low", maxAllowed: "medium" },
  resolution: { setTo: "low", maxAllowed: "high" },
  exclusions: { setTo: "low", maxAllowed: "high" },
  titles: { setTo: "low", maxAllowed: "medium" },
  media: { setTo: "low", maxAllowed: "medium" },
} as const
const RESULT_TYPES: readonly (ResultType | undefined)[] = ["batch", "best", "alt", undefined]

export function queryProxy(query: object): {
  readonly proxy: object
  readonly accessed: Set<string>
} {
  const accessed = new Set<string>()
  return {
    accessed,
    proxy: new Proxy(query, {
      get(target, property, receiver) {
        if (typeof property === "string") accessed.add(property)
        return Reflect.get(target, property, receiver)
      },
    }),
  }
}

export function computeAccuracy(accessed: ReadonlySet<string>): Accuracy {
  let bestSetToRank = Number.POSITIVE_INFINITY
  let worstMaxAllowedRank = 0
  for (const key of accessed) {
    if (!(key in QUERY_RULES)) continue
    const rule = Reflect.get(QUERY_RULES, key)
    bestSetToRank = Math.min(bestSetToRank, Reflect.get(ACCURACY_RANK, rule.setTo))
    worstMaxAllowedRank = Math.max(worstMaxAllowedRank, Reflect.get(ACCURACY_RANK, rule.maxAllowed))
  }
  if (bestSetToRank === Number.POSITIVE_INFINITY) bestSetToRank = 0
  return ACCURACIES[Math.max(bestSetToRank, worstMaxAllowedRank)] ?? "low"
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function sanitizeResults(value: unknown, maximum: Accuracy): readonly object[] {
  if (!Array.isArray(value)) return []
  const results: object[] = []
  const maximumRank = ACCURACY_RANK[maximum]
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const hash = Reflect.get(item, "hash")
    const link = Reflect.get(item, "link")
    if (
      typeof hash !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash) ||
      typeof link !== "string" ||
      link.length === 0
    ) {
      continue
    }
    const accuracy = Reflect.get(item, "accuracy")
    const accuracyRank =
      typeof accuracy === "string" && accuracy in ACCURACY_RANK
        ? Reflect.get(ACCURACY_RANK, accuracy)
        : undefined
    const date = Reflect.get(item, "date")
    const id = Reflect.get(item, "id")
    const type = Reflect.get(item, "type")
    const size = Reflect.get(item, "size")
    results.push({
      hash: hash.toLowerCase(),
      accuracy: accuracyRank !== undefined && accuracyRank <= maximumRank ? accuracy : maximum,
      title: typeof Reflect.get(item, "title") === "string" ? Reflect.get(item, "title") : "",
      link,
      seeders: finiteCount(Reflect.get(item, "seeders")),
      leechers: finiteCount(Reflect.get(item, "leechers")),
      downloads: finiteCount(Reflect.get(item, "downloads")),
      size: typeof size === "number" && Number.isFinite(size) ? Math.max(0, size) : 0,
      date: date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0),
      id: typeof id === "number" ? id : undefined,
      type: RESULT_TYPES.find((candidate) => candidate === type),
    })
  }
  return results
}
