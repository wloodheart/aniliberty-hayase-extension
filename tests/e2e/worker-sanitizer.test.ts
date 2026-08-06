import { afterEach, describe, expect, test } from "bun:test"

import {
  createReleaseWorkspace,
  type ReleaseWorkspace,
  removeReleaseWorkspace,
  replaceReleaseArtifact,
} from "./support/artifacts.ts"
import { HayaseWorkerHarness, type WorkerQuery } from "./support/hayase-harness.ts"

const query = {
  media: {},
  anilistId: 1,
  anidbAid: 2,
  anidbEid: 3,
  tvdbId: 4,
  tvdbEId: 5,
  imdbId: "tt1",
  tmdbId: "6",
  titles: ["Sanitizer Fixture"],
  episode: 1,
  episodeCount: 1,
  absoluteEpisodeNumber: 7,
  resolution: "1080",
  exclusions: [],
} satisfies WorkerQuery

let workspace: ReleaseWorkspace | undefined

afterEach(() => {
  removeReleaseWorkspace(workspace)
  workspace = undefined
})

async function fixtureHarness(sourceBody: string): Promise<HayaseWorkerHarness> {
  workspace = await createReleaseWorkspace()
  replaceReleaseArtifact(
    workspace,
    `const source={test:async()=>true,single:async query=>{${sourceBody}},batch:async()=>[],movie:async()=>[]};export default source`,
  )
  return HayaseWorkerHarness.create(workspace, new URL("http://127.0.0.1:1/api/v1/"))
}

describe("pinned Hayase Worker sanitizer conformance", () => {
  test("sanitizes mixed malformed results field by field and drops invalid entries", async () => {
    // Given: a generated fixture artifact returning one malformed result beside valid entries
    await using harness = await fixtureHarness(`
      void query.absoluteEpisodeNumber;
      return [
        null,
        {hash:"invalid",link:"magnet:?invalid"},
        {
          hash:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          link:"magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          title:42,seeders:1.6,leechers:-2,downloads:Number.NaN,size:-5,
          date:new Date("invalid"),id:"invalid",type:"unsupported",accuracy:"unsupported"
        },
        {
          hash:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          link:"magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          title:"valid",seeders:1,leechers:2,downloads:3,size:4,
          date:new Date(1000),id:9,type:"best",accuracy:"low"
        }
      ]
    `)

    // When: the malformed source output crosses the actual Worker message boundary
    const value = await harness.call("single", query)

    // Then: pinned rounding, defaults, accuracy clamp, optional fields, and entry dropping apply
    expect(value).toEqual([
      {
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accuracy: "low",
        title: "",
        link: "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        seeders: 2,
        leechers: 0,
        downloads: 0,
        size: 0,
        date: new Date(0),
        id: undefined,
        type: undefined,
      },
      {
        hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        accuracy: "low",
        title: "valid",
        link: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        seeders: 1,
        leechers: 2,
        downloads: 3,
        size: 4,
        date: new Date(1000),
        id: 9,
        type: "best",
      },
    ])
  })

  test("returns an empty array when a source returns a non-array", async () => {
    // Given: a generated fixture artifact returning the wrong collection shape
    await using harness = await fixtureHarness("void query.anidbEid; return {results: []}")

    // When: the value crosses the actual Worker sanitizer
    const value = await harness.call("single", query)

    // Then: pinned Hayase behavior safely normalizes it to an empty array
    expect(value).toEqual([])
  })

  test("matches every pinned optional-ID and absolute-episode accuracy rule", async () => {
    // Given: one generated artifact that accesses exactly one optional query field per call
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(
      workspace,
      `
        const fields=["anidbAid","anidbEid","tvdbId","tvdbEId","imdbId","tmdbId","absoluteEpisodeNumber"];
        let index=0;
        const result={
          hash:"cccccccccccccccccccccccccccccccccccccccc",
          link:"magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc",
          title:"query-rule",seeders:0,leechers:0,downloads:0,size:1,
          date:new Date(0),accuracy:"low"
        };
        export default {
          test:async()=>true,
          single:async query=>{void query[fields[index++]];return [result]},
          batch:async()=>[],movie:async()=>[]
        }
      `,
    )
    await using harness = await HayaseWorkerHarness.create(
      workspace,
      new URL("http://127.0.0.1:1/api/v1/"),
    )

    // When: each optional rule independently crosses the query proxy and sanitizer
    const accuracies: string[] = []
    for (let index = 0; index < 7; index += 1) {
      const value = await harness.call("single", query)
      if (Array.isArray(value)) accuracies.push(value[0]?.accuracy ?? "missing")
    }

    // Then: every setTo/maxAllowed pair matches the pinned Worker table
    expect(accuracies).toEqual(["medium", "high", "medium", "high", "medium", "medium", "low"])
  })
})
