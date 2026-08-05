import {
  type ClassDeclaration,
  type InterfaceDeclaration,
  isArrayTypeNode,
  isFunctionTypeNode,
  isLiteralTypeNode,
  isNumericLiteral,
  isParenthesizedTypeNode,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isTypeOperatorNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  type Node,
  type PropertyDeclaration,
  type PropertySignatureDeclaration,
  SyntaxKind,
  type TypeAliasDeclaration,
  type TypeNode,
} from "typescript/unstable/ast"

import type { ContractProperty } from "./hayase-contract-model.ts"

export type Property = PropertyDeclaration | PropertySignatureDeclaration
export type NamedDeclaration = ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration

const expandedAliases = new Set(["Accuracy", "SearchFunction", "SearchOptions"])

export function memberMap(members: readonly Node[]): ReadonlyMap<string, Property> {
  const properties = members.filter(
    (member): member is Property =>
      isPropertyDeclaration(member) || isPropertySignatureDeclaration(member),
  )
  return new Map(properties.map((property) => [property.name.getText(), property]))
}

function canonicalType(
  type: TypeNode | undefined,
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): string {
  if (type === undefined) return "missing"
  if (type.kind === SyntaxKind.AnyKeyword || type.kind === SyntaxKind.UnknownKeyword) {
    return "unknown"
  }
  if (type.kind === SyntaxKind.BooleanKeyword) return "boolean"
  if (type.kind === SyntaxKind.NumberKeyword) return "number"
  if (type.kind === SyntaxKind.ObjectKeyword) return "incompatible:ObjectKeyword"
  if (type.kind === SyntaxKind.StringKeyword) return "string"
  if (isArrayTypeNode(type)) return `${canonicalType(type.elementType, allDeclarations)}[]`
  if (isParenthesizedTypeNode(type)) return canonicalType(type.type, allDeclarations)
  if (isTypeOperatorNode(type)) {
    const operator =
      type.operator === SyntaxKind.ReadonlyKeyword
        ? "readonly "
        : `incompatible:${SyntaxKind[type.operator]} `
    return `${operator}${canonicalType(type.type, allDeclarations)}`
  }
  if (isUnionTypeNode(type)) {
    return type.types
      .map((part) => canonicalType(part, allDeclarations))
      .toSorted()
      .join("|")
  }
  if (isLiteralTypeNode(type)) {
    if (isStringLiteral(type.literal)) return JSON.stringify(type.literal.text)
    if (isNumericLiteral(type.literal)) return type.literal.text
    if (type.literal.kind === SyntaxKind.FalseKeyword) return "false"
    if (type.literal.kind === SyntaxKind.TrueKeyword) return "true"
    return `incompatible:${SyntaxKind[type.kind]}`
  }
  if (isTypeQueryNode(type)) return `typeof ${type.exprName.getText()}`
  if (isTypeLiteralNode(type)) {
    const fields = [...memberMap(type.members)]
      .map(([name, property]) => ({ name, ...canonicalProperty(property, allDeclarations) }))
      .toSorted((left, right) => left.name.localeCompare(right.name))
    return `{${fields.map((field) => `${field.name}${field.optional ? "?" : ""}:${field.type}`).join(";")}}`
  }
  if (isFunctionTypeNode(type)) {
    const parameters = type.parameters.map((parameter) => {
      const optional = parameter.questionToken === undefined ? "" : "?"
      return `${canonicalType(parameter.type, allDeclarations)}${optional}`
    })
    return `(${parameters.join(",")})->${canonicalType(type.type, allDeclarations)}`
  }
  if (isTypeReferenceNode(type)) {
    const name = type.typeName.getText()
    const alias = allDeclarations.get(name)
    if (expandedAliases.has(name) && alias !== undefined && isTypeAliasDeclaration(alias)) {
      return canonicalType(alias.type, allDeclarations)
    }
    const typeArguments = type.typeArguments?.map((argument) =>
      canonicalType(argument, allDeclarations),
    )
    return typeArguments === undefined ? name : `${name}<${typeArguments.join(",")}>`
  }
  return `incompatible:${SyntaxKind[type.kind]}`
}

export function canonicalProperty(
  property: Property,
  allDeclarations: ReadonlyMap<string, NamedDeclaration>,
): ContractProperty {
  return {
    optional: property.postfixToken?.kind === SyntaxKind.QuestionToken,
    type: canonicalType(property.type, allDeclarations),
  }
}
