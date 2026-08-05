import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const checker = "scripts/check-hayase-contract.ts"
const pinnedFixture = "tests/fixtures/hayase/types-56151c7.d.ts"

type CheckerRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

type DriftCase = {
  readonly name: string
  readonly from: string
  readonly to: string
  readonly path: string
}

async function runFixture(fixture: string): Promise<CheckerRun> {
  const process = Bun.spawn(["bun", "run", checker, "--fixture", fixture], {
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

const driftCases: DriftCase[] = [
  {
    name: "update type",
    from: "update?: string",
    to: "update?: number",
    path: "ExtensionConfig.update.type",
  },
  {
    name: "update optionality",
    from: "update?: string",
    to: "update: string",
    path: "ExtensionConfig.update.optional",
  },
  {
    name: "tmdbId type",
    from: "tmdbId?: string",
    to: "tmdbId?: number",
    path: "AnimeQuery.tmdbId.type",
  },
  {
    name: "hash type",
    from: "hash: string",
    to: "hash: object",
    path: "TorrentResult.hash.type",
  },
  {
    name: "url removal",
    from: "  url?: string\n",
    to: "",
    path: "ExtensionConfig.url",
  },
  {
    name: "url type",
    from: "url?: string",
    to: "url?: number",
    path: "ExtensionConfig.url.type",
  },
  {
    name: "options removal",
    from: "  options?: SearchOptions\n",
    to: "",
    path: "ExtensionConfig.options",
  },
  {
    name: "options type",
    from: "options?: SearchOptions",
    to: "options?: string",
    path: "ExtensionConfig.options.type",
  },
  {
    name: "updatePeers removal",
    from: "  updatePeers?: false\n",
    to: "",
    path: "ExtensionConfig.updatePeers",
  },
  {
    name: "updatePeers type",
    from: "updatePeers?: false",
    to: "updatePeers?: true",
    path: "ExtensionConfig.updatePeers.type",
  },
  {
    name: "manifest option schema",
    from: "default: unknown",
    to: "default: string",
    path: "ExtensionConfig.options.type",
  },
  {
    name: "injected fetch type",
    from: "fetch: typeof fetch",
    to: "fetch: string",
    path: "AnimeQuery.fetch.type",
  },
]

test("accepts the pinned consumed Hayase declarations", async () => {
  // Given: the reduced declaration fixture from the pinned upstream commit
  // When: the compatibility checker normalizes it
  const result = await runFixture(pinnedFixture)

  // Then: the consumed contract is compatible
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ compatible: true, source: "fixture" })
})

test("ignores declaration order and instruction-like comments", async () => {
  // Given: equivalent declarations in a different order with hostile prose comments
  // When: the compatibility checker normalizes the AST
  const result = await runFixture("tests/fixtures/hayase/types-reordered.d.ts")

  // Then: comments and order do not alter compatibility
  expect(result.exitCode).toBe(0)
})

test("names a removed TorrentSource batch method", async () => {
  // Given: a declaration fixture missing only TorrentSource.batch
  // When: the compatibility checker compares its structure
  const result = await runFixture("tests/fixtures/hayase/types-breaking.d.ts")

  // Then: it fails with a path-specific machine-readable difference
  expect(result.exitCode).toBe(1)
  expect(JSON.parse(result.stderr)).toMatchObject({
    compatible: false,
    differences: [{ actual: "missing", path: "TorrentSource.batch" }],
  })
})

test("rejects malformed declarations before comparison", async () => {
  // Given: syntactically invalid declaration input
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-hayase-malformed-"))
  const fixturePath = join(directory, "types.d.ts")
  writeFileSync(fixturePath, "export interface AnimeQuery { titles: string[ }")

  try {
    // When: the compatibility checker parses it
    const result = await runFixture(fixturePath)

    // Then: it fails without claiming a successful comparison
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ compatible: false, source: "syntax" })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test("produces deterministic success output", async () => {
  // Given: the same pinned fixture in two isolated checker processes
  // When: both runs normalize it
  const [first, second] = await Promise.all([runFixture(pinnedFixture), runFixture(pinnedFixture)])

  // Then: successful output is byte-identical
  expect(first.stdout).toBe(second.stdout)
})

test.each(driftCases)("rejects $name drift", async ({ from, path, to }) => {
  // Given: one consumed declaration changed from the pinned contract
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-hayase-drift-"))
  const fixturePath = join(directory, "types.d.ts")
  writeFileSync(fixturePath, readFileSync(pinnedFixture, "utf8").replace(from, to))

  try {
    // When: the compatibility checker compares the mutated declaration
    const result = await runFixture(fixturePath)

    // Then: it fails at the changed structural path
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({
      compatible: false,
      differences: [{ path }],
    })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
