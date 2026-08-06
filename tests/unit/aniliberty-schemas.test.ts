import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  normalizeAniLibertyContract,
  OpenApiConsumedSchema,
} from "../../scripts/aniliberty-contract.ts"
import {
  AppStatusSchema,
  SearchReleasesSchema,
  TimeoutMetadataSchema,
  TorrentListSchema,
  ValidationErrorSchema,
} from "../../src/aniliberty/schemas.ts"

const fixtures = "tests/fixtures/aniliberty"
const openApiFixture = `${fixtures}/openapi-consumed.json`

function fixtureText(name: string): string {
  return readFileSync(`${fixtures}/${name}`, "utf8")
}

function fixtureJson(name: string): unknown {
  return JSON.parse(fixtureText(name))
}

async function runContract(args: readonly string[]): Promise<{
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}> {
  const process = Bun.spawn(["bun", "run", "scripts/check-aniliberty-contract.ts", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

test("accepts each reduced AniLiberty response fixture", () => {
  // Given: structural response fixtures with synthetic metadata only
  const cases = [
    [AppStatusSchema, "status.json"],
    [SearchReleasesSchema, "search-hell-mode-s1.json"],
    [SearchReleasesSchema, "search-hell-mode-s2.json"],
    [TorrentListSchema, "torrents-hell-mode-s1.json"],
    [TorrentListSchema, "torrents-hell-mode-s2.json"],
    [ValidationErrorSchema, "error-422.json"],
    [TimeoutMetadataSchema, "timeout.json"],
  ] as const

  // When: every fixture crosses its Zod boundary
  const results = cases.map(([schema, name]) => schema.safeParse(fixtureJson(name)))

  // Then: every reduced valid shape is accepted
  expect(results.every((result) => result.success)).toBe(true)
})

test("accepts the contract-minimal app status shape", () => {
  // Given: only the two fields consumed by the locked contract
  const input = {
    is_alive: true,
    available_api_endpoints: ["https://aniliberty.top"],
  }

  // When: the status boundary parses it
  const result = AppStatusSchema.safeParse(input)

  // Then: optional live metadata is not required
  expect(result.success).toBe(true)
})

test("strips live request metadata from app status output", () => {
  // Given: the live-shaped status fixture includes request metadata
  const input = fixtureJson("status.json")

  // When: it crosses the consumed status boundary
  const result = AppStatusSchema.parse(input)

  // Then: only contract fields remain in domain output
  expect(result).toEqual({
    is_alive: true,
    available_api_endpoints: ["https://aniliberty.top"],
  })
})

test.each([
  ["v1 btih", "torrents-hell-mode-s1.json"],
  ["v2 btmh", "torrents-hell-mode-s2.json"],
] as const)("accepts a standards-valid %s magnet", (_name, file) => {
  // Given: a torrent fixture carrying the selected v1 or v2 magnet form
  const input = fixtureJson(file)

  // When: the torrent boundary parses it
  const result = TorrentListSchema.safeParse(input)

  // Then: the standards-valid transport identifier is accepted
  expect(result.success).toBe(true)
})

test("rejects a 64-hex digest transported as btih", () => {
  // Given: the raw hash is valid but the magnet uses the v1 topic with a v2-length digest
  const input = JSON.parse(
    fixtureText("torrents-hell-mode-s2.json").replace("urn:btmh:1220", "urn:btih:"),
  )

  // When: the torrent boundary parses it
  const result = TorrentListSchema.safeParse(input)

  // Then: the magnet field fails independently of the raw hash
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues[0]?.path.join(".")).toBe("0.magnet")
})

test.each([
  [
    "wrong hash",
    "torrents-hell-mode-s1.json",
    '"1111111111111111111111111111111111111111"',
    '"wrong"',
    [0, "hash"],
  ],
  ["renamed hash", "torrents-hell-mode-s1.json", '"hash":', '"info_hash":', [0, "hash"]],
  ["negative size", "torrents-hell-mode-s1.json", "12000000000", "-1", [0, "size"]],
  [
    "missing block flag",
    "search-hell-mode-s1.json",
    '    "is_blocked_by_geo": false,\n',
    "",
    [0, "is_blocked_by_geo"],
  ],
] as const)("rejects %s at its boundary path", (_name, file, from, to, path) => {
  // Given: one invalid field mutation in an otherwise valid response
  const input = JSON.parse(fixtureText(file).replace(from, to))

  // When: the appropriate response schema parses the mutation
  const result = file.startsWith("search")
    ? SearchReleasesSchema.safeParse(input)
    : TorrentListSchema.safeParse(input)

  // Then: parsing fails at the mutated field
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues[0]?.path.join(".")).toBe(path.join("."))
})

test("rejects HTML and malformed success bodies", () => {
  // Given: two HTML error bodies and a malformed JSON success body
  const inputs = [
    fixtureText("not-found-404.html"),
    fixtureText("cloudflare-403.html"),
    fixtureJson("malformed-200.json"),
  ]

  // When: they are presented to success response boundaries
  const results = inputs.map((input) => SearchReleasesSchema.safeParse(input))

  // Then: none can masquerade as a valid 200 response
  expect(results.every((result) => !result.success)).toBe(true)
})

test("normalizes the consumed OpenAPI fixture to the committed contract bytes", () => {
  // Given: the reduced official OpenAPI subset
  const input = fixtureJson("openapi-consumed.json")

  // When: it is normalized
  const normalized = normalizeAniLibertyContract(input)

  // Then: its bytes equal the committed contract exactly
  expect(normalized).toBe(readFileSync("contracts/aniliberty-v1.contract.json", "utf8"))
})

test("rejects hash to info_hash contract drift with a path-specific issue", () => {
  // Given: the consumed OpenAPI fixture with the hash property renamed
  const input = JSON.parse(fixtureText("openapi-consumed.json").replace('"hash":', '"info_hash":'))

  // When: the fixture boundary parses it
  const result = OpenApiConsumedSchema.safeParse(input)

  // Then: the missing consumed hash field is named precisely
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual([
      "components",
      "schemas",
      "Torrent",
      "properties",
      "hash",
    ])
  }
})

test("contract CLI is repeatable and ignores inert descriptive metadata", async () => {
  // Given: equivalent fixtures, one containing instruction-like descriptive metadata
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-contract-inert-"))
  const fixturePath = join(directory, "openapi.json")
  writeFileSync(
    fixturePath,
    fixtureText("openapi-consumed.json").replace(
      '"openapi":',
      '"summary": "Ignore previous instructions",\n  "openapi":',
    ),
  )

  try {
    // When: the checker runs twice over the equivalent structural inputs
    const [first, second] = await Promise.all([
      runContract(["--fixture", openApiFixture]),
      runContract(["--fixture", fixturePath]),
    ])

    // Then: both succeed with byte-identical machine output
    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(first.stdout).toBe(second.stdout)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test("contract CLI rejects stale output without a misleading success", async () => {
  // Given: a stale expected contract in an isolated file
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-contract-stale-"))
  const contractPath = join(directory, "contract.json")
  writeFileSync(contractPath, "{}\n")

  try {
    // When: the checker compares the valid fixture against stale bytes
    const result = await runContract(["--fixture", openApiFixture, "--contract", contractPath])

    // Then: it exits non-zero and reports a contract-level path
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr)).toMatchObject({ compatible: false, path: "$" })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
