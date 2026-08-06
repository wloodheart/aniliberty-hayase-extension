import type { ZodType } from "zod"

import { disposeResponseBody } from "./dispose-response.ts"
import {
  AniLibertyContentTypeError,
  AniLibertyContractError,
  type AniLibertyEndpoint,
  AniLibertyMalformedJsonError,
} from "./errors.ts"

export async function parseAniLibertyResponse<T>(
  response: Response,
  schema: ZodType<T>,
  endpoint: AniLibertyEndpoint,
): Promise<T> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    await disposeResponseBody(response)
    throw new AniLibertyContentTypeError(endpoint, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new AniLibertyMalformedJsonError(endpoint, response.status)
    throw error
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new AniLibertyContractError(endpoint, response.status)
  return parsed.data
}
