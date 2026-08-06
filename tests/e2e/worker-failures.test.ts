import { afterEach, describe, expect, test } from "bun:test"

import {
  createReleaseWorkspace,
  type ReleaseWorkspace,
  removeReleaseWorkspace,
  replaceReleaseArtifact,
} from "./support/artifacts.ts"
import { HayaseWorkerHarness, type WorkerQuery } from "./support/hayase-harness.ts"

const query = {
  media: {
    id: 1,
    title: { userPreferred: "Safe", english: "Safe", romaji: null, native: null },
    startDate: { year: 2026 },
    episodes: 1,
    format: "TV",
  },
  anilistId: 1,
  titles: ["Safe"],
  episode: 1,
  episodeCount: 1,
  resolution: "1080",
  exclusions: [],
} satisfies WorkerQuery

let workspace: ReleaseWorkspace | undefined

afterEach(() => {
  removeReleaseWorkspace(workspace)
  workspace = undefined
})

async function captureError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new TypeError("Expected operation to fail")
}

async function withinGuard<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new TypeError("Operation did not settle")), 1000)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

describe("Hayase Worker harness failure settlement", () => {
  test("rejects a closed-port bridge fetch without an unhandled timeout", async () => {
    // Given: a real generated adapter and a deterministic closed local port
    workspace = await createReleaseWorkspace()
    await using harness = await HayaseWorkerHarness.create(
      workspace,
      new URL("http://127.0.0.1:1/api/v1/"),
    )

    // When: the Worker requests AniLiberty through the failed bridge
    const error = await captureError(withinGuard(harness.call("single", query)))

    // Then: the public call rejects promptly with no transport context
    expect(error.message).toBe("AniLiberty is unavailable")
    expect(error.stack).toBe("WorkerCompatibilityError: AniLiberty is unavailable")
  })

  test("rejects load when the imported artifact exits the Worker", async () => {
    // Given: a checksum-consistent fixture artifact that exits during dynamic import
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(workspace, "process.exit(7);export default {}")

    // When: the harness waits for Worker load
    const error = await captureError(
      withinGuard(HayaseWorkerHarness.create(workspace, new URL("http://127.0.0.1:1/api/v1/"))),
    )

    // Then: close settles the load promise without artifact or path leakage
    expect(error.message).toBe("Worker stopped unexpectedly")
    expect(error.stack).toBe("WorkerCompatibilityError: Worker stopped unexpectedly")
  })

  test("rejects load when artifact evaluation fails", async () => {
    // Given: a checksum-consistent fixture artifact that throws private context during import
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(workspace, 'throw new Error("private load");export default {}')

    // When: dynamic import rejects inside the Worker runtime
    const error = await captureError(
      withinGuard(HayaseWorkerHarness.create(workspace, new URL("http://127.0.0.1:1/api/v1/"))),
    )

    // Then: load rejection is stable and strips artifact context
    expect(error.message).toBe("Worker artifact import failed")
    expect(error.stack).toBe("WorkerCompatibilityError: Worker artifact import failed")
  })

  test("closes idempotently while artifact loading remains pending", async () => {
    // Given: a checksum-consistent fixture artifact with permanently pending top-level evaluation
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(workspace, "await new Promise(()=>{});export default {}")
    const harness = HayaseWorkerHarness.start(workspace, new URL("http://127.0.0.1:1/api/v1/"))
    const readiness = captureError(harness.ready())

    // When: cleanup runs twice before load can settle
    await withinGuard(harness.close())
    await withinGuard(harness.close())

    // Then: load rejects deterministically instead of blocking close
    const error = await withinGuard(readiness)
    expect(error.message).toBe("Worker closed")
  })

  test("rejects pending calls on runtime error and permits idempotent close", async () => {
    // Given: a loaded fixture artifact that crashes its Worker during a pending call
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(
      workspace,
      `export default {test:async()=>true,single:()=>{setTimeout(()=>{throw new Error("private runtime")},0);return new Promise(()=>{})},batch:async()=>[],movie:async()=>[]}`,
    )
    const harness = await HayaseWorkerHarness.create(
      workspace,
      new URL("http://127.0.0.1:1/api/v1/"),
    )

    // When: the Worker crashes while one call is pending
    const error = await captureError(withinGuard(harness.call("single", query)))

    // Then: runtime context is hidden and repeated cleanup always settles
    expect(error.message).toBe("Worker stopped unexpectedly")
    expect(error.stack).not.toContain("private runtime")
    await withinGuard(harness.close())
    await withinGuard(harness.close())
    expect((await captureError(harness.call("single", query))).message).toBe("Worker closed")
  })

  test("rejects pending calls when a loaded Worker exits unexpectedly", async () => {
    // Given: a loaded fixture artifact that exits from a source call
    workspace = await createReleaseWorkspace()
    replaceReleaseArtifact(
      workspace,
      `export default {test:async()=>true,single:()=>{process.exit(9)},batch:async()=>[],movie:async()=>[]}`,
    )
    await using harness = await HayaseWorkerHarness.create(
      workspace,
      new URL("http://127.0.0.1:1/api/v1/"),
    )

    // When: the pending call loses its Worker
    const error = await captureError(withinGuard(harness.call("single", query)))

    // Then: the Bun close event settles it without exposing exit details
    expect(error.message).toBe("Worker stopped unexpectedly")
    expect(error.stack).toBe("WorkerCompatibilityError: Worker stopped unexpectedly")
  })
})
