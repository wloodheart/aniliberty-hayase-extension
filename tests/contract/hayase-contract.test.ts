import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const checker = "scripts/check-hayase-contract.ts"

type CheckerRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
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

test("accepts the pinned consumed Hayase declarations", async () => {
  // Given: the reduced declaration fixture from the pinned upstream commit
  // When: the compatibility checker normalizes it
  const result = await runFixture("tests/fixtures/hayase/types-56151c7.d.ts")

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
  const [first, second] = await Promise.all([
    runFixture("tests/fixtures/hayase/types-56151c7.d.ts"),
    runFixture("tests/fixtures/hayase/types-56151c7.d.ts"),
  ])

  // Then: successful output is byte-identical
  expect(first.stdout).toBe(second.stdout)
})
