import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { type Browser, type BrowserContext, chromium } from "playwright-core"
import { z } from "zod"

import {
  createReleaseWorkspace,
  type ReleaseWorkspace,
  removeReleaseWorkspace,
} from "./support/artifacts.ts"
import { loadReleaseArtifact } from "./support/manifest-loader.ts"

const HEALTH_URL = "https://aniliberty.top/api/v1/app/status"
const TEST_ORIGIN = "https://hayase.test/"
const WorkerOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("result"), value: z.boolean() }),
  z.object({ kind: z.literal("error"), name: z.string(), message: z.string() }),
  z.object({ kind: z.literal("timeout") }),
])

let browser: Browser | undefined
let workspace: ReleaseWorkspace | undefined

async function invokeWorkerTest(context: BrowserContext, artifactBase64: string): Promise<unknown> {
  const page = await context.newPage()
  await page.goto(TEST_ORIGIN)
  return page.evaluate(async (bundleBase64) => {
    const workerSource = `
self.onmessage = async (event) => {
  try {
    const bytes = Uint8Array.from(atob(event.data), (character) => character.charCodeAt(0))
    const moduleUrl = URL.createObjectURL(new Blob([bytes], { type: "application/javascript" }))
    const namespace = await import(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
    self.postMessage({ kind: "result", value: await namespace.default.test() })
  } catch (error) {
    self.postMessage({
      kind: "error",
      name: error instanceof Error ? error.name : "NonError",
      message: error instanceof Error ? error.message : "non-error rejection",
    })
  }
}`
    const workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "application/javascript" }),
    )
    const worker = new Worker(workerUrl, { type: "module", name: "aniliberty.torrents" })
    try {
      return await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => resolve({ kind: "timeout" }), 5_000)
        worker.onmessage = (event) => {
          clearTimeout(timer)
          resolve(event.data)
        }
        worker.postMessage(bundleBase64)
      })
    } finally {
      worker.terminate()
      URL.revokeObjectURL(workerUrl)
    }
  }, artifactBase64)
}

async function createBrowserFixture(): Promise<{
  readonly artifactBase64: string
  readonly context: BrowserContext
}> {
  const activeBrowser = browser
  const activeWorkspace = workspace
  if (activeBrowser === undefined || activeWorkspace === undefined) {
    throw new TypeError("Browser compatibility setup is unavailable")
  }
  const context = await activeBrowser.newContext({ serviceWorkers: "block" })
  await context.route(TEST_ORIGIN, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Hayase</title>" }),
  )
  return {
    artifactBase64: Buffer.from(loadReleaseArtifact(activeWorkspace)).toString("base64"),
    context,
  }
}

beforeAll(async () => {
  workspace = await createReleaseWorkspace()
  const { PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromiumExecutable } = process.env
  browser = await chromium.launch({
    executablePath: chromiumExecutable ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  })
})

afterAll(async () => {
  await browser?.close()
  removeReleaseWorkspace(workspace)
})

describe("generated artifact in pinned Hayase's browser Worker path", () => {
  test("passes zero-argument test with native Worker fetch when CORS and health are valid", async () => {
    // Given: the generated bundle, a Hayase-like origin, and a valid CORS-enabled health response
    const { artifactBase64, context } = await createBrowserFixture()
    let healthRequests = 0
    await context.route(HEALTH_URL, (route) => {
      healthRequests += 1
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({ is_alive: true, available_api_endpoints: [] }),
      })
    })

    try {
      // When: a real browser Blob Worker imports the bundle and Hayase invokes test() with no arguments
      const rawOutcome = await invokeWorkerTest(context, artifactBase64)

      // Then: the current artifact should report availability before Hayase's five-second race
      expect(WorkerOutcomeSchema.parse(rawOutcome)).toEqual({ kind: "result", value: true })
      expect(healthRequests).toBe(1)
    } finally {
      await context.close()
    }
  })

  test("keeps malformed health responses sanitized after one native Worker request", async () => {
    // Given: the generated bundle and a malformed CORS-enabled health response
    const { artifactBase64, context } = await createBrowserFixture()
    let healthRequests = 0
    await context.route(HEALTH_URL, (route) => {
      healthRequests += 1
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({ is_alive: "yes", available_api_endpoints: [] }),
      })
    })

    try {
      // When: the module Worker invokes test() against the malformed response
      const rawOutcome = await invokeWorkerTest(context, artifactBase64)

      // Then: contract validation still fails through the public sanitized boundary without a retry
      expect(WorkerOutcomeSchema.parse(rawOutcome)).toEqual({
        kind: "error",
        name: "TorrentSourceUnavailableError",
        message: "AniLiberty is unavailable",
      })
      expect(healthRequests).toBe(1)
    } finally {
      await context.close()
    }
  })
})
