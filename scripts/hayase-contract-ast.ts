import {
  type ClassDeclaration,
  type FunctionTypeNode,
  type InterfaceDeclaration,
  isArrayTypeNode,
  isClassDeclaration,
  isFunctionTypeNode,
  isInterfaceDeclaration,
  isIntersectionTypeNode,
  isLiteralTypeNode,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  type Node,
  type PropertyDeclaration,
  type PropertySignatureDeclaration,
  type SourceFile,
  SyntaxKind,
  type TypeAliasDeclaration,
  type TypeNode,
} from "typescript/unstable/ast"
import { API } from "typescript/unstable/async"

import type { ContractDifference, HayaseContract } from "./hayase-contract-model.ts"

type Property = PropertyDeclaration | PropertySignatureDeclaration
type NamedDeclaration = ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration

export class ContractInputError extends Error {
  readonly name = "ContractInputError"
}

export class ContractSyntaxError extends Error {
  readonly name = "ContractSyntaxError"

  constructor(readonly diagnosticCount: number) {
    super(`Hayase declaration source has ${diagnosticCount} syntax diagnostic(s)`)
  }
}

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

function memberMap(
  members: readonly Node[] | undefined,
  sourceFile: SourceFile,
): ReadonlyMap<string, Property> {
  if (members === undefined) return new Map()
  const properties = members.filter(
    (member): member is Property =>
      isPropertyDeclaration(member) || isPropertySignatureDeclaration(member),
  )
  return new Map(properties.map((property) => [property.name.getText(sourceFile), property]))
}

function properties(
  declaration: NamedDeclaration | undefined,
  sourceFile: SourceFile,
): ReadonlyMap<string, Property> {
  if (declaration === undefined || isTypeAliasDeclaration(declaration)) return new Map()
  return memberMap(declaration.members, sourceFile)
}

function literalValues(type: TypeNode | undefined): readonly string[] {
  if (type === undefined) return []
  if (isUnionTypeNode(type)) return type.types.flatMap(literalValues).toSorted()
  if (isLiteralTypeNode(type) && isStringLiteral(type.literal)) return [type.literal.text]
  return []
}

function canonicalType(type: TypeNode | undefined): string {
  if (type === undefined) return "missing"
  if (isArrayTypeNode(type)) return `${canonicalType(type.elementType)}[]`
  if (isUnionTypeNode(type)) return type.types.map(canonicalType).toSorted().join("|")
  if (isTypeQueryNode(type)) return `typeof ${type.exprName.getText()}`
  if (isTypeReferenceNode(type)) {
    const argumentsText = type.typeArguments?.map(canonicalType).join(",")
    return argumentsText === undefined
      ? type.typeName.getText()
      : `${type.typeName.getText()}<${argumentsText}>`
  }
  const keywordNames = new Map([
    [SyntaxKind.BooleanKeyword, "boolean"],
    [SyntaxKind.NumberKeyword, "number"],
    [SyntaxKind.StringKeyword, "string"],
  ])
  return keywordNames.get(type.kind) ?? "unsupported"
}

function resolveFunctionType(
  type: TypeNode | undefined,
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): FunctionTypeNode | undefined {
  if (type !== undefined && isFunctionTypeNode(type)) return type
  if (type === undefined || !isTypeReferenceNode(type)) return undefined
  const referenced = allDeclarations.get(type.typeName.getText())
  return referenced !== undefined &&
    isTypeAliasDeclaration(referenced) &&
    isFunctionTypeNode(referenced.type)
    ? referenced.type
    : undefined
}

function signature(
  property: Property | undefined,
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): string {
  const functionType = resolveFunctionType(property?.type, allDeclarations)
  if (functionType === undefined) return "missing"
  const parameters = functionType.parameters.map(
    (parameter) =>
      `${canonicalType(parameter.type)}${parameter.questionToken === undefined ? "" : "?"}`,
  )
  return `(${parameters.join(",")}):${canonicalType(functionType.type)}`
}

function fields(memberMap: ReadonlyMap<string, Property>, optional: boolean): readonly string[] {
  return [...memberMap]
    .filter(
      ([, property]) => (property.postfixToken?.kind === SyntaxKind.QuestionToken) === optional,
    )
    .map(([name]) => name)
    .toSorted()
}

function hasInjectedFetch(alias: NamedDeclaration | undefined, sourceFile: SourceFile): boolean {
  if (
    alias === undefined ||
    !isTypeAliasDeclaration(alias) ||
    !isIntersectionTypeNode(alias.type)
  ) {
    return false
  }
  return alias.type.types.some(
    (type) =>
      isTypeLiteralNode(type) &&
      canonicalType(memberMap(type.members, sourceFile).get("fetch")?.type) === "typeof fetch",
  )
}

function normalize(sourceFile: SourceFile, upstreamSha: string): HayaseContract {
  const all = declarations(sourceFile)
  const manifest = properties(all.get("ExtensionConfig"), sourceFile)
  const query = properties(all.get("AnimeQuery"), sourceFile)
  const result = properties(all.get("TorrentResult"), sourceFile)
  const source = properties(all.get("TorrentSource"), sourceFile)
  const accuracy = all.get("Accuracy")
  const requiredManifestKeys = [
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
    "type",
    "update",
    "version",
  ]
  return {
    upstreamSha,
    manifestVersion: 2,
    manifest: {
      requiredKeys: requiredManifestKeys.filter((key) => manifest.has(key)),
      sourceTypes: literalValues(manifest.get("type")?.type).filter((type) => type === "torrent"),
      accuracyLiterals:
        accuracy !== undefined && isTypeAliasDeclaration(accuracy)
          ? literalValues(accuracy.type)
          : [],
      mediaLiterals: literalValues(manifest.get("media")?.type),
    },
    animeQuery: {
      requiredFields: fields(query, false),
      optionalFields: fields(query, true),
      resolutionLiterals: literalValues(query.get("resolution")?.type),
      mediaBoundary: query.has("media") ? "opaque" : "missing",
      injectedFetch: hasInjectedFetch(all.get("AnimeQueryWithFetch"), sourceFile),
    },
    torrentResult: {
      requiredFields: fields(result, false),
      optionalFields: fields(result, true),
      typeLiterals: literalValues(result.get("type")?.type),
    },
    torrentSource: {
      test: signature(source.get("test"), all),
      single: signature(source.get("single"), all),
      batch: signature(source.get("batch"), all),
      movie: signature(source.get("movie"), all),
    },
  }
}

export async function parseHayaseContract(
  filePath: string,
  upstreamSha: string,
): Promise<HayaseContract> {
  const api = new API({ cwd: process.cwd() })
  try {
    const snapshot = await api.updateSnapshot({ openFiles: [filePath] })
    try {
      const project = await snapshot.getDefaultProjectForFile(filePath)
      if (project === undefined)
        throw new ContractInputError(`No TypeScript project for ${filePath}`)
      const diagnostics = await project.program.getSyntacticDiagnostics(filePath)
      if (diagnostics.length > 0) throw new ContractSyntaxError(diagnostics.length)
      const sourceFile = await project.program.getSourceFile(filePath)
      if (sourceFile === undefined) throw new ContractInputError(`Unable to parse ${filePath}`)
      return normalize(sourceFile, upstreamSha)
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await api.close()
  }
}

export function compareHayaseContracts(
  expected: HayaseContract,
  actual: HayaseContract,
): readonly ContractDifference[] {
  const found: ContractDifference[] = []
  for (const method of ["test", "single", "batch", "movie"] as const) {
    if (expected.torrentSource[method] !== actual.torrentSource[method]) {
      found.push({
        actual: actual.torrentSource[method],
        expected: expected.torrentSource[method],
        path: `TorrentSource.${method}`,
      })
    }
  }
  for (const section of ["manifest", "animeQuery", "torrentResult"] as const) {
    if (JSON.stringify(expected[section]) !== JSON.stringify(actual[section])) {
      found.push({ actual: actual[section], expected: expected[section], path: section })
    }
  }
  return found
}
