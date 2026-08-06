import { expect, test } from "bun:test"

type SmokeRun = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

async function runSmoke(fixture: string): Promise<SmokeRun> {
  const process = Bun.spawn(
    ["bun", "run", "scripts/live-smoke.ts", "--fixture", `tests/fixtures/aniliberty/${fixture}`],
    { stderr: "pipe", stdout: "pipe" },
  )
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

test("emits PASS_API_OK when the fixture is a schema-valid success", async () => {
  // Given: a deterministic successful health response fixture
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-ok.json")

  // Then: it emits only the stable pass token and exits successfully
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "PASS_API_OK\n" })
})

test("emits SKIP_ENV_BLOCKED_403 when the environment is denied", async () => {
  // Given: a deterministic upstream denial fixture
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-blocked-403.json")

  // Then: denial is an explicit environmental skip rather than drift
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "SKIP_ENV_BLOCKED_403\n" })
})

test("emits SKIP_ENV_TRANSIENT_HTTP when the upstream is temporarily unavailable", async () => {
  // Given: a deterministic transient response fixture
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-transient-503.json")

  // Then: transient infrastructure is an explicit successful skip
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "SKIP_ENV_TRANSIENT_HTTP\n" })
})

test("emits FAIL_SCHEMA_DRIFT when a successful JSON body violates the schema", async () => {
  // Given: a 200 JSON response with a malformed consumed shape
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-malformed-200.json")

  // Then: confirmed response drift fails without exposing the body
  expect(result).toEqual({ exitCode: 1, stderr: "FAIL_SCHEMA_DRIFT\n", stdout: "" })
})

test("rejects unknown fixture fields before smoke classification", async () => {
  // Given: an otherwise valid fixture with an unrecognized boundary field
  // When: the smoke CLI parses the fixture
  const result = await runSmoke("live-unknown-field.json")

  // Then: the fixture itself is rejected instead of silently stripped
  expect(result).toEqual({ exitCode: 1, stderr: "FAIL_FIXTURE_INVALID\n", stdout: "" })
})

test("rejects a JSON-looking media type with the wrong top-level type", async () => {
  // Given: a valid body labeled with a substring lookalike media type
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-evil-content-type.json")

  // Then: the successful body is confirmed schema drift rather than PASS
  expect(result).toEqual({ exitCode: 1, stderr: "FAIL_SCHEMA_DRIFT\n", stdout: "" })
})

test("accepts case-insensitive JSON media type with a valid parameter", async () => {
  // Given: a valid response using RFC media-type casing and a charset parameter
  // When: the smoke CLI classifies the fixture
  const result = await runSmoke("live-json-parameter.json")

  // Then: the exact application/json media type remains valid
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "PASS_API_OK\n" })
})
