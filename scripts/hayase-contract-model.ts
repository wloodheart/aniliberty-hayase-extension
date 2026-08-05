export type HayaseContract = {
  readonly upstreamSha: string
  readonly manifestVersion: 2
  readonly manifest: {
    readonly requiredKeys: readonly string[]
    readonly sourceTypes: readonly string[]
    readonly accuracyLiterals: readonly string[]
    readonly mediaLiterals: readonly string[]
  }
  readonly animeQuery: {
    readonly requiredFields: readonly string[]
    readonly optionalFields: readonly string[]
    readonly resolutionLiterals: readonly string[]
    readonly mediaBoundary: string
    readonly injectedFetch: boolean
  }
  readonly torrentResult: {
    readonly requiredFields: readonly string[]
    readonly optionalFields: readonly string[]
    readonly typeLiterals: readonly string[]
  }
  readonly torrentSource: {
    readonly test: string
    readonly single: string
    readonly batch: string
    readonly movie: string
  }
}

export type ContractDifference = {
  readonly actual: unknown
  readonly expected: unknown
  readonly path: string
}
