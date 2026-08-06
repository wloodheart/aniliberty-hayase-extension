import { z } from "zod"

export class DuplicateJsonKeyError extends Error {
  readonly name = "DuplicateJsonKeyError"

  constructor(readonly key: string) {
    super(`Duplicate JSON object key: ${key}`)
  }
}

function skipWhitespace(source: string, start: number): number {
  let index = start
  while (/\s/.test(source[index] ?? "")) index += 1
  return index
}

function scanString(
  source: string,
  start: number,
): { readonly end: number; readonly value: string } {
  let index = start + 1
  let escaped = false
  while (index < source.length) {
    const character = source[index]
    if (!escaped && character === '"') {
      const end = index + 1
      return { end, value: z.string().parse(JSON.parse(source.slice(start, end))) }
    }
    escaped = !escaped && character === "\\"
    index += 1
  }
  throw new SyntaxError("Unterminated JSON string")
}

function scanArray(source: string, start: number): number {
  let index = skipWhitespace(source, start + 1)
  if (source[index] === "]") return index + 1
  while (index < source.length) {
    index = skipWhitespace(source, scanValue(source, index))
    if (source[index] === "]") return index + 1
    index = skipWhitespace(source, index + 1)
  }
  throw new SyntaxError("Unterminated JSON array")
}

function scanObject(source: string, start: number): number {
  const keys = new Set<string>()
  let index = skipWhitespace(source, start + 1)
  if (source[index] === "}") return index + 1
  while (index < source.length) {
    const key = scanString(source, index)
    if (keys.has(key.value)) throw new DuplicateJsonKeyError(key.value)
    keys.add(key.value)
    index = skipWhitespace(source, key.end)
    if (source[index] !== ":") throw new SyntaxError("Expected JSON object colon")
    index = skipWhitespace(source, scanValue(source, skipWhitespace(source, index + 1)))
    if (source[index] === "}") return index + 1
    index = skipWhitespace(source, index + 1)
  }
  throw new SyntaxError("Unterminated JSON object")
}

function scanValue(source: string, start: number): number {
  const index = skipWhitespace(source, start)
  const character = source[index]
  if (character === '"') return scanString(source, index).end
  if (character === "{") return scanObject(source, index)
  if (character === "[") return scanArray(source, index)
  let end = index
  while (end < source.length && !/[\s,}\]]/.test(source[end] ?? "")) end += 1
  return end
}

export function parseUniqueJson(source: string): unknown {
  const value: unknown = JSON.parse(source)
  scanValue(source, 0)
  return value
}
