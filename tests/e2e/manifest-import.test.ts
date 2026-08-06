import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { jsonResponse, withAniLibertyServer } from "../helpers/aniliberty-server.ts"
import {
  createReleaseWorkspace,
  type ReleaseWorkspace,
  removeReleaseWorkspace,
} from "./support/artifacts.ts"
import { HayaseWorkerHarness } from "./support/hayase-harness.ts"

let workspace: ReleaseWorkspace | undefined

async function captureError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new TypeError("Expected operation to fail")
}

beforeAll(async () => {
  workspace = await createReleaseWorkspace()
})

afterAll(() => removeReleaseWorkspace(workspace))

function mutateManifest(activeWorkspace: ReleaseWorkspace, field: string, value: string): void {
  const path = join(activeWorkspace.path, ".release-site", "index.json")
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest[0] = { ...manifest[0], [field]: value }
  writeFileSync(path, JSON.stringify(manifest))
}

describe("generated release manifest import", () => {
  test.each([
    ["version", "Release manifest version mismatch"],
    ["code", "Release manifest code URL mismatch"],
    ["sha256", "Release artifact checksum mismatch"],
  ])("rejects corrupt %s before starting playback", async (field, diagnostic) => {
    const activeWorkspace = workspace
    if (activeWorkspace === undefined) throw new TypeError("Release workspace is unavailable")
    const original = readFileSync(join(activeWorkspace.path, ".release-site", "index.json"))
    mutateManifest(activeWorkspace, field, field === "version" ? "9.9.9" : "corrupt")
    let requests = 0

    try {
      await withAniLibertyServer(
        () => {
          requests += 1
          return jsonResponse("[]")
        },
        async (baseUrl) => {
          const error = await captureError(HayaseWorkerHarness.create(activeWorkspace, baseUrl))
          expect(error.message).toBe(diagnostic)
        },
      )
    } finally {
      writeFileSync(join(activeWorkspace.path, ".release-site", "index.json"), original)
    }
    expect(requests).toBe(0)
  })

  test("rejects an invalid API hash with a context-free diagnostic", async () => {
    const activeWorkspace = workspace
    if (activeWorkspace === undefined) throw new TypeError("Release workspace is unavailable")
    const search = readFileSync(
      join(import.meta.dir, "..", "fixtures", "aniliberty", "search-hell-mode-s1.json"),
      "utf8",
    )
    const torrents = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "fixtures", "aniliberty", "torrents-hell-mode-s1.json"),
        "utf8",
      ),
    )
    const invalidTorrents = [{ ...torrents[0], hash: "unsafe-query-payload" }]
    let torrentRequests = 0
    const workerQuery = {
      media: {
        id: 1,
        title: { userPreferred: "Hell Mode", english: "Hell Mode", romaji: null, native: null },
        startDate: { year: 2026 },
        episodes: 12,
        format: "TV",
      },
      anilistId: 1,
      titles: ["Hell Mode"],
      episode: 5,
      episodeCount: 12,
      resolution: "1080" as const,
      exclusions: [],
    }

    await withAniLibertyServer(
      (request) => {
        if (new URL(request.url).pathname.endsWith("/app/search/releases")) {
          return jsonResponse(search)
        }
        torrentRequests += 1
        return Response.json(torrentRequests === 1 ? invalidTorrents : torrents)
      },
      async (baseUrl) => {
        await using harness = await HayaseWorkerHarness.create(activeWorkspace, baseUrl)
        const failure = harness.call("single", workerQuery)
        const error = await captureError(failure)
        expect(error.message).toBe("AniLiberty is unavailable")
        expect(JSON.stringify(error)).not.toContain("unsafe-query-payload")
        const retry = await harness.call("single", workerQuery)
        expect(Array.isArray(retry) ? retry.map(({ hash }) => hash) : retry).toEqual([
          torrents[0].hash,
        ])
      },
    )
    expect(torrentRequests).toBe(2)
  })
})
