import { z } from "zod"

export const ReleaseIdSchema = z.number().int().positive().brand<"ReleaseId">()
export type ReleaseId = z.infer<typeof ReleaseIdSchema>

export const InfoHashSchema = z
  .string()
  .regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/)
  .brand<"InfoHash">()
export type InfoHash = z.infer<typeof InfoHashSchema>
