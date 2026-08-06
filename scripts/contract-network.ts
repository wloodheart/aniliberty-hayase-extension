import { readFileSync } from "node:fs"

import { z } from "zod"

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const fixtureSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("response"), status: z.number().int().min(100).max(599) }),
  z.strictObject({ kind: z.literal("transport"), reason: z.enum(["network", "timeout"]) }),
])

export type ContractSkipToken =
  | "SKIP_ENV_BLOCKED_403"
  | "SKIP_ENV_NETWORK"
  | "SKIP_ENV_TRANSIENT_HTTP"

export class ContractSkipError extends Error {
  readonly name = "ContractSkipError"

  constructor(readonly token: ContractSkipToken) {
    super(token)
  }
}

export class ContractEndpointDriftError extends Error {
  readonly name = "ContractEndpointDriftError"
  readonly token = "FAIL_ENDPOINT_DRIFT"

  constructor() {
    super("FAIL_ENDPOINT_DRIFT")
  }
}

export function classifyContractStatus(status: number): void {
  if (status === 200) return
  if (status === 403) throw new ContractSkipError("SKIP_ENV_BLOCKED_403")
  if (TRANSIENT_STATUSES.has(status)) throw new ContractSkipError("SKIP_ENV_TRANSIENT_HTTP")
  throw new ContractEndpointDriftError()
}

export function classifyNetworkFixture(path: string): never {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(path, "utf8")))
  switch (fixture.kind) {
    case "response":
      classifyContractStatus(fixture.status)
      throw new ContractEndpointDriftError()
    case "transport":
      throw new ContractSkipError("SKIP_ENV_NETWORK")
    default:
      return assertNever(fixture)
  }
}

export function isTransportFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
  )
}

function assertNever(value: never): never {
  return value
}
