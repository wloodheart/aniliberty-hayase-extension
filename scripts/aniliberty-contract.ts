import { z } from "zod"

import { extractAniLibertyConsumedContract } from "./aniliberty-contract-extract.ts"

const referenceSchema = z.strictObject({ $ref: z.string().min(1) })
const scalarPropertySchema = z.strictObject({
  type: z.enum(["boolean", "integer", "number", "string"]),
  format: z.string().optional(),
  nullable: z.boolean().optional(),
  minimum: z.number().optional(),
  pattern: z.string().optional(),
  brand: z.string().optional(),
  unit: z.string().optional(),
})
const arrayPropertySchema = z.strictObject({
  type: z.literal("array"),
  items: z.union([referenceSchema, scalarPropertySchema]),
})
const propertySchema = z.union([referenceSchema, scalarPropertySchema, arrayPropertySchema])
const objectDefinitionSchema = z.strictObject({
  type: z.literal("object"),
  required: z.array(z.string()),
  properties: z.record(z.string(), propertySchema),
})
const torrentDefinitionSchema = objectDefinitionSchema.extend({
  properties: z.strictObject({
    id: propertySchema,
    hash: propertySchema,
    size: propertySchema,
    type: propertySchema,
    label: propertySchema,
    codec: propertySchema,
    quality: propertySchema,
    magnet: propertySchema,
    seeders: propertySchema,
    bitrate: propertySchema,
    leechers: propertySchema,
    created_at: propertySchema,
    updated_at: propertySchema,
    is_hardsub: propertySchema,
    description: propertySchema,
    completed_times: propertySchema,
  }),
})
const arrayDefinitionSchema = z.strictObject({
  type: z.literal("array"),
  items: referenceSchema,
})
const endpointSchema = z.strictObject({
  get: z.strictObject({ response: z.string().min(1) }),
})

export const OpenApiConsumedSchema = z.object({
  openapi: z.literal("3.0.0"),
  info: z.strictObject({ version: z.literal("1.0.0") }),
  paths: z.strictObject({
    "/app/status": endpointSchema,
    "/app/search/releases": endpointSchema,
    "/anime/torrents/release/{releaseId}": endpointSchema,
  }),
  components: z.strictObject({
    schemas: z.strictObject({
      AppStatus: objectDefinitionSchema,
      ReleaseName: objectDefinitionSchema,
      ReleaseType: objectDefinitionSchema,
      ReleaseSeason: objectDefinitionSchema,
      SearchRelease: objectDefinitionSchema,
      SearchReleases: arrayDefinitionSchema,
      TorrentSource: objectDefinitionSchema,
      TorrentCodec: objectDefinitionSchema,
      TorrentQuality: objectDefinitionSchema,
      Torrent: torrentDefinitionSchema,
      TorrentList: arrayDefinitionSchema,
    }),
  }),
})

type JsonPrimitive = null | boolean | number | string
interface JsonArray extends ReadonlyArray<JsonValue> {}
interface JsonObject {
  readonly [key: string]: JsonValue
}
type JsonValue = JsonPrimitive | JsonArray | JsonObject

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize).toSorted((left, right) => {
      const leftText = JSON.stringify(left)
      const rightText = JSON.stringify(right)
      return leftText < rightText ? -1 : leftText > rightText ? 1 : 0
    })
  }
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

function formatJson(value: JsonValue, depth: number): string {
  if (value === null || typeof value !== "object") {
    return z.string().parse(JSON.stringify(value))
  }
  const indentation = "  ".repeat(depth)
  const childIndentation = `${indentation}  `
  if (Array.isArray(value)) {
    const items = value.map((item) => formatJson(item, depth + 1))
    const compact = `[${items.join(", ")}]`
    const containsOnlyScalars = value.every((item) => item === null || typeof item !== "object")
    if (containsOnlyScalars && childIndentation.length + compact.length <= 100) return compact
    return `[\n${items.map((item) => `${childIndentation}${item}`).join(",\n")}\n${indentation}]`
  }
  const entries = Object.entries(value).map(
    ([key, entry]) =>
      `${childIndentation}${z.string().parse(JSON.stringify(key))}: ${formatJson(entry, depth + 1)}`,
  )
  return `{\n${entries.join(",\n")}\n${indentation}}`
}

export function normalizeAniLibertyContract(input: unknown): string {
  const parsed = OpenApiConsumedSchema.parse(extractAniLibertyConsumedContract(input))
  return `${formatJson(canonicalize(z.json().parse(parsed)), 0)}\n`
}
