import { z } from "zod"

import { InfoHashSchema } from "./identifiers.ts"

export const TorrentSourceSchema = z.object({ value: z.string().min(1) })
export const TorrentCodecSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  label_color: z.string().min(1).nullable(),
  label_is_visible: z.boolean(),
})
export const TorrentQualitySchema = z.object({ value: z.string().min(1) })
const magnetPrefix = "magnet:?"
const v1TopicPrefix = "urn:btih:"
const v2TopicPrefix = "urn:btmh:1220"

function hasValidExactTopic(value: string): boolean {
  if (!value.startsWith(magnetPrefix)) return false
  const exactTopic = new URLSearchParams(value.slice(magnetPrefix.length)).get("xt")
  if (exactTopic === null) return false
  if (exactTopic.startsWith(v1TopicPrefix)) {
    const digest = exactTopic.slice(v1TopicPrefix.length)
    return digest.length === 40 && InfoHashSchema.safeParse(digest).success
  }
  if (exactTopic.startsWith(v2TopicPrefix)) {
    const digest = exactTopic.slice(v2TopicPrefix.length)
    return digest.length === 64 && InfoHashSchema.safeParse(digest).success
  }
  return false
}

const magnetSchema = z.string().refine(hasValidExactTopic)

const torrentIdentitySchema = z.object({
  id: z.number().int().positive(),
  hash: InfoHashSchema,
  size: z.number().int().positive(),
  type: TorrentSourceSchema,
  label: z.string().min(1),
  codec: TorrentCodecSchema,
  quality: TorrentQualitySchema,
  magnet: magnetSchema,
})

export const TorrentSchema = torrentIdentitySchema.extend({
  seeders: z.number().int().nonnegative(),
  bitrate: z.number().int().positive().nullable(),
  leechers: z.number().int().nonnegative(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  is_hardsub: z.boolean(),
  description: z.string().min(1),
  completed_times: z.number().int().nonnegative(),
})
export type Torrent = z.infer<typeof TorrentSchema>

export const TorrentListSchema = z.array(TorrentSchema)
