import type { Torrent } from "../aniliberty/schemas.ts"
import { InfoHashSchema, TorrentSchema } from "../aniliberty/schemas.ts"
import type { Resolution } from "../hayase/types.ts"
import { coversEpisode, parseEpisodeCoverage } from "../matching/episode-range.ts"
import type { DiscoveredTorrent, DiscoveryRequest, UnfilteredDiscoveryRecord } from "./types.ts"

function extractResolution(value: string): Resolution | null {
  const matches = value.matchAll(/(?:^|\D)(2160|1080|720|540|480)p?(?=\D|$)/giu)
  const resolutions = new Set(Array.from(matches, (match) => match[1]))
  if (resolutions.size !== 1) return null
  const resolution = resolutions.values().next().value
  switch (resolution) {
    case "2160":
    case "1080":
    case "720":
    case "540":
    case "480":
      return resolution
    default:
      return null
  }
}

function matchesResolution(torrent: Torrent, requested: Resolution): boolean {
  if (requested === "") return true
  const quality = extractResolution(torrent.quality.value)
  const label = extractResolution(torrent.label)
  return quality !== null && quality === label && quality === requested
}

function isExcluded(torrent: Torrent, exclusions: readonly string[]): boolean {
  const metadata = [
    torrent.label,
    torrent.codec.value,
    torrent.codec.label,
    torrent.type.value,
    torrent.codec.label_color ?? "",
    torrent.quality.value,
  ].map((value) => value.normalize("NFKC").toLowerCase())

  return exclusions.some((exclusion) => {
    const normalized = exclusion.normalize("NFKC").toLowerCase().trim()
    return normalized.length > 0 && metadata.some((value) => value.includes(normalized))
  })
}

function topicHash(exactTopic: string): string | null {
  if (exactTopic.startsWith("urn:btih:")) {
    const digest = exactTopic.slice("urn:btih:".length)
    return digest.length === 40 && InfoHashSchema.safeParse(digest).success ? digest : null
  }
  if (exactTopic.startsWith("urn:btmh:1220")) {
    const digest = exactTopic.slice("urn:btmh:1220".length)
    return digest.length === 64 && InfoHashSchema.safeParse(digest).success ? digest : null
  }
  return null
}

function hasConsistentIdentity(torrent: Torrent): boolean {
  const expectedHash = torrent.hash.toLowerCase()
  const topics = new URLSearchParams(torrent.magnet.slice("magnet:?".length)).getAll("xt")
  return (
    topics.length > 0 && topics.every((topic) => topicHash(topic)?.toLowerCase() === expectedHash)
  )
}

function applyMode(
  record: UnfilteredDiscoveryRecord,
  torrent: Torrent,
  request: DiscoveryRequest,
): DiscoveredTorrent | null {
  switch (request.mode) {
    case "single": {
      if (!coversEpisode(torrent.description, request.episode)) return null
      const coverage = parseEpisodeCoverage(torrent.description)
      if (coverage.kind === "coverage" && coverage.start < coverage.end) {
        return { release: record.release, torrent, type: "batch" }
      }
      return { release: record.release, torrent }
    }
    case "batch": {
      const coverage = parseEpisodeCoverage(torrent.description)
      if (coverage.kind !== "coverage" || coverage.start !== 1 || coverage.end <= 1) return null
      return { release: record.release, torrent, type: "batch" }
    }
    case "movie":
      return record.release.type.value.toLowerCase() === "movie"
        ? { release: record.release, torrent }
        : null
  }
}

export function filterTorrents(
  record: UnfilteredDiscoveryRecord | null,
  request: DiscoveryRequest,
): readonly DiscoveredTorrent[] {
  if (record === null) return []
  const results: DiscoveredTorrent[] = []
  const hashes = new Set<string>()

  for (const rawTorrent of record.torrents) {
    const parsed = TorrentSchema.safeParse(rawTorrent)
    if (!parsed.success) continue
    const torrent = parsed.data
    const hash = torrent.hash.toLowerCase()
    if (
      hashes.has(hash) ||
      !hasConsistentIdentity(torrent) ||
      !matchesResolution(torrent, request.resolution) ||
      isExcluded(torrent, request.exclusions)
    ) {
      continue
    }
    const result = applyMode(record, torrent, request)
    if (result === null) continue
    hashes.add(hash)
    results.push(result)
  }

  return results
}
