import {
  isClassDeclaration,
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  type SourceFile,
} from "typescript/unstable/ast"

import {
  canonicalProperty,
  memberMap,
  type NamedDeclaration,
  type Property,
} from "./hayase-contract-canonical.ts"
import type { ContractProperties, HayaseContract } from "./hayase-contract-model.ts"

const manifestFields = [
  "accuracy",
  "code",
  "deprecated",
  "description",
  "icon",
  "id",
  "languages",
  "manifestVersion",
  "media",
  "name",
  "options",
  "rateLimit",
  "ratio",
  "type",
  "update",
  "updatePeers",
  "url",
  "version",
]
const queryFields = [
  "absoluteEpisodeNumber",
  "anidbAid",
  "anidbEid",
  "anilistId",
  "episode",
  "episodeCount",
  "exclusions",
  "imdbId",
  "media",
  "resolution",
  "titles",
  "tmdbId",
  "tvdbEId",
  "tvdbId",
]
const resultFields = [
  "accuracy",
  "date",
  "downloads",
  "hash",
  "id",
  "leechers",
  "link",
  "seeders",
  "size",
  "title",
  "type",
]
const sourceFields = ["batch", "movie", "single", "test"]

function declarations(sourceFile: SourceFile): ReadonlyMap<string, NamedDeclaration> {
  const found = new Map<string, NamedDeclaration>()
  for (const statement of sourceFile.statements) {
    if (
      isClassDeclaration(statement) ||
      isInterfaceDeclaration(statement) ||
      isTypeAliasDeclaration(statement)
    ) {
      const name = statement.name?.text
      if (name !== undefined) found.set(name, statement)
    }
  }
  return found
}

function declarationMembers(
  declaration: NamedDeclaration | undefined,
): ReadonlyMap<string, Property> {
  if (declaration === undefined || isTypeAliasDeclaration(declaration)) return new Map()
  return memberMap(declaration.members)
}

function normalizeFields(
  members: ReadonlyMap<string, Property>,
  names: readonly string[],
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): ContractProperties {
  return Object.fromEntries(
    names.flatMap((name) => {
      const property = members.get(name)
      return property === undefined ? [] : [[name, canonicalProperty(property, allDeclarations)]]
    }),
  )
}

function injectedFetch(
  alias: NamedDeclaration | undefined,
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): ContractProperties {
  if (alias === undefined || !isTypeAliasDeclaration(alias)) return {}
  const fetchProperties: Property[] = []
  alias.type.forEachChild((node) => {
    if (isTypeLiteralNode(node)) {
      const property = memberMap(node.members).get("fetch")
      if (property !== undefined) fetchProperties.push(property)
    }
    return undefined
  })
  return Object.fromEntries(
    fetchProperties.map((property) => ["fetch", canonicalProperty(property, allDeclarations)]),
  )
}

export function normalizeHayaseSource(sourceFile: SourceFile, upstreamSha: string): HayaseContract {
  const all = declarations(sourceFile)
  return {
    upstreamSha,
    manifestVersion: 2,
    manifest: normalizeFields(declarationMembers(all.get("ExtensionConfig")), manifestFields, all),
    animeQuery: {
      ...normalizeFields(declarationMembers(all.get("AnimeQuery")), queryFields, all),
      ...injectedFetch(all.get("AnimeQueryWithFetch"), all),
    },
    torrentResult: normalizeFields(declarationMembers(all.get("TorrentResult")), resultFields, all),
    torrentSource: normalizeFields(declarationMembers(all.get("TorrentSource")), sourceFields, all),
  }
}
