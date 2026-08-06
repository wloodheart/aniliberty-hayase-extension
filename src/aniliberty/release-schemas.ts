import { z } from "zod"

import { ReleaseIdSchema } from "./identifiers.ts"

export const ReleaseNameSchema = z.object({
  main: z.string().min(1),
  english: z.string().min(1),
  alternative: z.string().min(1).nullable(),
})

export const ReleaseTypeSchema = z.object({ value: z.string().min(1) })
export const ReleaseSeasonSchema = z.object({ value: z.string().min(1).nullable() })

export const SearchReleaseSchema = z.object({
  id: ReleaseIdSchema,
  type: ReleaseTypeSchema,
  year: z.number().int().positive(),
  name: ReleaseNameSchema,
  season: ReleaseSeasonSchema,
  episodes_total: z.number().int().positive().nullable(),
  is_blocked_by_geo: z.boolean(),
  is_blocked_by_copyrights: z.boolean(),
})
export type SearchRelease = z.infer<typeof SearchReleaseSchema>

export const SearchReleasesSchema = z.array(SearchReleaseSchema)
