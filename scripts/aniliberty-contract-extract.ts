import { z } from "zod"

const fullDocumentSchema = z.object({
  openapi: z.unknown(),
  info: z.object({ version: z.unknown() }),
  paths: z.record(z.string(), z.unknown()),
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
})
const endpointSchema = z.object({ get: z.object({ response: z.unknown() }) })
const objectDefinitionSchema = z.object({
  type: z.unknown(),
  required: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
})
const arrayDefinitionSchema = z.object({ type: z.unknown(), items: z.unknown() })
const propertyRecordSchema = z.record(z.string(), z.unknown())

const PROPERTY_KEYS = [
  "$ref",
  "type",
  "format",
  "nullable",
  "minimum",
  "pattern",
  "brand",
  "unit",
] as const
const CONSUMED_PROPERTIES = {
  AppStatus: ["is_alive", "available_api_endpoints"],
  ReleaseName: ["main", "english", "alternative"],
  ReleaseSeason: ["value"],
  ReleaseType: ["value"],
  SearchRelease: [
    "id",
    "type",
    "year",
    "name",
    "season",
    "episodes_total",
    "is_blocked_by_geo",
    "is_blocked_by_copyrights",
  ],
  Torrent: [
    "id",
    "hash",
    "size",
    "type",
    "label",
    "codec",
    "quality",
    "magnet",
    "seeders",
    "bitrate",
    "leechers",
    "created_at",
    "updated_at",
    "is_hardsub",
    "description",
    "completed_times",
  ],
  TorrentCodec: ["value", "label", "label_color", "label_is_visible"],
  TorrentQuality: ["value"],
  TorrentSource: ["value"],
} as const

function extractProperty(input: unknown): Readonly<Record<string, unknown>> {
  const parsed = propertyRecordSchema.safeParse(input)
  if (!parsed.success) return {}
  const property = parsed.data
  const entries: Array<readonly [string, unknown]> = []
  for (const key of PROPERTY_KEYS) {
    if (Object.hasOwn(property, key)) entries.push([key, property[key]])
  }
  const { items } = property
  if (Object.hasOwn(property, "items")) entries.push(["items", extractProperty(items)])
  return Object.fromEntries(entries)
}

function extractObjectDefinition(
  input: unknown,
  propertyNames: readonly string[],
): Readonly<Record<string, unknown>> {
  const definition = objectDefinitionSchema.parse(input)
  const properties = Object.fromEntries(
    propertyNames.map((name) => [name, extractProperty(definition.properties[name])]),
  )
  return {
    type: definition.type,
    required: definition.required.filter((name) => propertyNames.includes(name)),
    properties,
  }
}

function extractArrayDefinition(input: unknown): Readonly<Record<string, unknown>> {
  const definition = arrayDefinitionSchema.parse(input)
  return { type: definition.type, items: extractProperty(definition.items) }
}

function extractEndpoint(input: unknown): Readonly<Record<string, unknown>> {
  const endpoint = endpointSchema.parse(input)
  return { get: { response: endpoint.get.response } }
}

export function extractAniLibertyConsumedContract(input: unknown): unknown {
  const document = fullDocumentSchema.parse(input)
  const schemas = document.components.schemas
  const {
    AppStatus,
    ReleaseName,
    ReleaseType,
    ReleaseSeason,
    SearchRelease,
    SearchReleases,
    TorrentSource,
    TorrentCodec,
    TorrentQuality,
    Torrent,
    TorrentList,
  } = schemas
  return {
    openapi: document.openapi,
    info: { version: document.info.version },
    paths: {
      "/app/status": extractEndpoint(document.paths["/app/status"]),
      "/app/search/releases": extractEndpoint(document.paths["/app/search/releases"]),
      "/anime/torrents/release/{releaseId}": extractEndpoint(
        document.paths["/anime/torrents/release/{releaseId}"],
      ),
    },
    components: {
      schemas: {
        AppStatus: extractObjectDefinition(AppStatus, CONSUMED_PROPERTIES.AppStatus),
        ReleaseName: extractObjectDefinition(ReleaseName, CONSUMED_PROPERTIES.ReleaseName),
        ReleaseType: extractObjectDefinition(ReleaseType, CONSUMED_PROPERTIES.ReleaseType),
        ReleaseSeason: extractObjectDefinition(ReleaseSeason, CONSUMED_PROPERTIES.ReleaseSeason),
        SearchRelease: extractObjectDefinition(SearchRelease, CONSUMED_PROPERTIES.SearchRelease),
        SearchReleases: extractArrayDefinition(SearchReleases),
        TorrentSource: extractObjectDefinition(TorrentSource, CONSUMED_PROPERTIES.TorrentSource),
        TorrentCodec: extractObjectDefinition(TorrentCodec, CONSUMED_PROPERTIES.TorrentCodec),
        TorrentQuality: extractObjectDefinition(TorrentQuality, CONSUMED_PROPERTIES.TorrentQuality),
        Torrent: extractObjectDefinition(Torrent, CONSUMED_PROPERTIES.Torrent),
        TorrentList: extractArrayDefinition(TorrentList),
      },
    },
  }
}
