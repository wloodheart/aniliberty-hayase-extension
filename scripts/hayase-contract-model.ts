export type ContractProperty = {
  readonly optional: boolean
  readonly type: string
}

export type ContractProperties = Readonly<Record<string, ContractProperty>>

export type HayaseContract = {
  readonly upstreamSha: string
  readonly manifestVersion: 2
  readonly manifest: ContractProperties
  readonly animeQuery: ContractProperties
  readonly torrentResult: ContractProperties
  readonly torrentSource: ContractProperties
}

export type ContractDifference = {
  readonly actual: unknown
  readonly expected: unknown
  readonly path: string
}

function compareProperties(
  expected: ContractProperties,
  actual: ContractProperties,
  declarationName: string,
): readonly ContractDifference[] {
  const propertyNames = new Set([...Object.keys(expected), ...Object.keys(actual)])
  return [...propertyNames].toSorted().flatMap((propertyName) => {
    const expectedProperty = expected[propertyName]
    const actualProperty = actual[propertyName]
    if (expectedProperty === undefined || actualProperty === undefined) {
      return [
        {
          actual: actualProperty ?? "missing",
          expected: expectedProperty ?? "missing",
          path: `${declarationName}.${propertyName}`,
        },
      ]
    }
    const differences: ContractDifference[] = []
    if (actualProperty.optional !== expectedProperty.optional) {
      differences.push({
        actual: actualProperty.optional,
        expected: expectedProperty.optional,
        path: `${declarationName}.${propertyName}.optional`,
      })
    }
    if (actualProperty.type !== expectedProperty.type) {
      differences.push({
        actual: actualProperty.type,
        expected: expectedProperty.type,
        path: `${declarationName}.${propertyName}.type`,
      })
    }
    return differences
  })
}

export function compareHayaseContracts(
  expected: HayaseContract,
  actual: HayaseContract,
): readonly ContractDifference[] {
  return [
    ...compareProperties(expected.manifest, actual.manifest, "ExtensionConfig"),
    ...compareProperties(expected.animeQuery, actual.animeQuery, "AnimeQuery"),
    ...compareProperties(expected.torrentResult, actual.torrentResult, "TorrentResult"),
    ...compareProperties(expected.torrentSource, actual.torrentSource, "TorrentSource"),
  ]
}
