import { z } from "zod"

export const AppStatusSchema = z.object({
  is_alive: z.boolean(),
  available_api_endpoints: z.array(z.url()),
})
export type AppStatus = z.infer<typeof AppStatusSchema>

export const ValidationErrorSchema = z.object({
  errors: z.record(z.string(), z.array(z.string().min(1)).min(1)),
})

export const TimeoutMetadataSchema = z.strictObject({
  kind: z.literal("timeout"),
  timeout_ms: z.number().int().positive(),
  attempts: z.number().int().positive(),
})
