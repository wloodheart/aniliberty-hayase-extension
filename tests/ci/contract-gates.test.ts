import { expect, test } from "bun:test"

async function run(command: readonly string[]): Promise<{
  readonly exitCode: number
  readonly stderr: string
}> {
  const process = Bun.spawn([...command], { stderr: "pipe", stdout: "pipe" })
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr }
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
