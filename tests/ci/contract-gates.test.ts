import { expect, test } from "bun:test"

async function run(command: readonly string[]): Promise<{
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}> {
  const process = Bun.spawn([...command], { stderr: "pipe", stdout: "pipe" })
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

test("reports the consumed Hayase member removed by a breaking fixture", async () => {
  // Given: a Hayase declaration fixture missing TorrentSource.batch
  // When: the existing AST-backed contract CLI compares it
  const result = await run([
    "bun",
    "run",
    "contract:hayase",
    "--",
    "--fixture",
    "tests/fixtures/hayase/types-breaking.d.ts",
  ])

  // Then: the structural member path is reported as confirmed drift
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('"path":"TorrentSource.batch"')
})

test("reports the consumed AniLiberty hash removed by a breaking fixture", async () => {
  // Given: an OpenAPI fixture that renamed the consumed Torrent.hash field
  // When: the existing reduced OpenAPI contract CLI compares it
  const result = await run([
    "bun",
    "run",
    "contract:aniliberty",
    "--",
    "--fixture",
    "tests/fixtures/aniliberty/openapi-breaking.json",
  ])

  // Then: schema parsing fails at the consumed hash path
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('"path":["components","schemas","Torrent","properties","hash"]')
})

test("ignores additive unconsumed AniLiberty OpenAPI material", async () => {
  // Given: valid consumed contracts plus an unrelated endpoint, schema, and property
  // When: the reduced contract CLI extracts and compares the consumed subset
  const result = await run([
    "bun",
    "run",
    "contract:aniliberty",
    "--",
    "--fixture",
    "tests/fixtures/aniliberty/openapi-additive.json",
  ])

  // Then: the consumed normalization remains byte-compatible
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe('{"compatible":true,"contract":"aniliberty-v1"}\n')
})

test.each([
  ["contract:hayase", "blocked-403.json", "SKIP_ENV_BLOCKED_403"],
  ["contract:hayase", "transient-503.json", "SKIP_ENV_TRANSIENT_HTTP"],
  ["contract:hayase", "timeout.json", "SKIP_ENV_NETWORK"],
  ["contract:hayase", "network.json", "SKIP_ENV_NETWORK"],
  ["contract:aniliberty", "blocked-403.json", "SKIP_ENV_BLOCKED_403"],
  ["contract:aniliberty", "transient-503.json", "SKIP_ENV_TRANSIENT_HTTP"],
  ["contract:aniliberty", "timeout.json", "SKIP_ENV_NETWORK"],
  ["contract:aniliberty", "network.json", "SKIP_ENV_NETWORK"],
] as const)("classifies %s %s as an environmental skip", async (script, fixture, token) => {
  // Given: deterministic network metadata without a live request
  // When: the contract CLI classifies the network fixture
  const result = await run([
    "bun",
    "run",
    script,
    "--",
    "--network-fixture",
    `tests/fixtures/network/${fixture}`,
  ])

  // Then: the documented SKIP token exits zero
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe(`${token}\n`)
})

test.each(["contract:hayase", "contract:aniliberty"] as const)(
  "classifies %s permanent endpoint loss as failure",
  async (script) => {
    // Given: a deterministic non-transient endpoint response
    // When: the contract CLI classifies the response
    const result = await run([
      "bun",
      "run",
      script,
      "--",
      "--network-fixture",
      "tests/fixtures/network/not-found-404.json",
    ])

    // Then: endpoint drift remains nonzero
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("FAIL_ENDPOINT_DRIFT")
  },
)
