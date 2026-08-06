import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

import { buildRelease, ExistingReleaseError } from "../../scripts/build-release.ts"
import {
  type PublicationOperations,
  ReleaseCommittedCleanupError,
  ReleaseRollbackError,
  ReleaseRollbackPendingError,
} from "../../scripts/release-publication.ts"
import { createReleaseWorkspace } from "../helpers/release-workspace.ts"

const workspaces: string[] = []

function createWorkspace(): string {
  const workspace = createReleaseWorkspace("aniliberty-recovery-")
  workspaces.push(workspace)
  return workspace
}

async function captureBuild(operation: Promise<void>): Promise<unknown> {
  try {
    await operation
    return undefined
  } catch (error) {
    return error
  }
}

async function leaveRollbackPending(workspace: string): Promise<unknown> {
  await buildRelease({ repository: "example/aniliberty", version: "1.0.0", workspace })
  let renameCount = 0
  const failingPublication = {
    rename(source: string, destination: string): void {
      renameCount += 1
      if (renameCount >= 2) {
        throw new TypeError("injected rename failure")
      }
      renameSync(source, destination)
    },
  } satisfies PublicationOperations

  return captureBuild(
    buildRelease(
      { repository: "example/aniliberty", version: "1.0.1", workspace },
      failingPublication,
    ),
  )
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true })
  }
})

describe("release recovery states", () => {
  test("retains the previous site outside staging when publication and restoration fail", async () => {
    // Given: a previous release and injected failures for publication plus restoration
    const workspace = createWorkspace()

    // When: the next version reaches the publication swap
    const error = await leaveRollbackPending(workspace)

    // Then: recovery details and the only previous site remain outside cleaned staging
    expect(error).toBeInstanceOf(ReleaseRollbackError)
    if (!(error instanceof ReleaseRollbackError)) {
      throw new TypeError("Expected rollback failure")
    }
    expect(error.backupPath).toBe(join(workspace, ".release-site.backup"))
    expect(existsSync(join(workspace, ".release-site.backup", "v1.0.0"))).toBeTrue()
    expect(existsSync(join(workspace, ".release-site.lock"))).toBeFalse()
    expect(
      readdirSync(workspace).filter((entry) => entry.startsWith(".release-site.stage-")),
    ).toEqual([])
  })

  test("blocks a different-version retry while rollback remains pending", async () => {
    // Given: a double rollback failure retained the only previous site as a backup
    const workspace = createWorkspace()
    await leaveRollbackPending(workspace)

    // When: a different version retries through the normal publisher
    const retryError = await captureBuild(
      buildRelease({ repository: "example/aniliberty", version: "1.0.2", workspace }),
    )

    // Then: rollback-pending state blocks publication and preserves the prior version
    expect(retryError).toBeInstanceOf(ReleaseRollbackPendingError)
    if (!(retryError instanceof ReleaseRollbackPendingError)) {
      throw new TypeError("Expected rollback-pending failure")
    }
    expect(retryError.sitePath).toBe(join(workspace, ".release-site"))
    expect(retryError.backupPath).toBe(join(workspace, ".release-site.backup"))
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
    expect(existsSync(join(workspace, ".release-site.backup", "v1.0.0"))).toBeTrue()
    expect(existsSync(join(workspace, ".release-site.backup", "v1.0.2"))).toBeFalse()
    expect(existsSync(join(workspace, ".release-site.lock"))).toBeFalse()
    expect(
      readdirSync(workspace).filter((entry) => entry.startsWith(".release-site.stage-")),
    ).toEqual([])
  })

  test("recovers committed cleanup state before rejecting an existing-version retry", async () => {
    // Given: publication committed both versions but backup cleanup failed
    const workspace = createWorkspace()
    await buildRelease({ repository: "example/aniliberty", version: "1.0.0", workspace })
    const cleanupFailure = {
      rename: renameSync,
      removeBackup(): void {
        throw new TypeError("injected backup cleanup failure")
      },
    }
    const publicationError = await captureBuild(
      buildRelease(
        { repository: "example/aniliberty", version: "1.0.1", workspace },
        cleanupFailure,
      ),
    )

    // When: cleanup fails again, then a normal same-version retry recovers
    let recoveryRenameCalled = false
    const retryCleanupFailure = {
      rename(source: string, destination: string): void {
        recoveryRenameCalled = true
        renameSync(source, destination)
      },
      removeBackup(): void {
        throw new TypeError("repeated backup cleanup failure")
      },
    }
    const cleanupRetryError = await captureBuild(
      buildRelease(
        { repository: "example/aniliberty", version: "2.0.0", workspace },
        retryCleanupFailure,
      ),
    )
    const existingRetryError = await captureBuild(
      buildRelease({ repository: "example/aniliberty", version: "1.0.1", workspace }),
    )

    // Then: failures are typed, recovery precedes staging, and no immutable version is lost
    expect(publicationError).toBeInstanceOf(ReleaseCommittedCleanupError)
    expect(cleanupRetryError).toBeInstanceOf(ReleaseCommittedCleanupError)
    if (!(cleanupRetryError instanceof ReleaseCommittedCleanupError)) {
      throw new TypeError("Expected committed-cleanup failure")
    }
    expect(cleanupRetryError.sitePath).toBe(join(workspace, ".release-site"))
    expect(cleanupRetryError.backupPath).toBe(join(workspace, ".release-site.backup"))
    expect(recoveryRenameCalled).toBeFalse()
    expect(existingRetryError).toBeInstanceOf(ExistingReleaseError)
    expect(
      readdirSync(join(workspace, ".release-site"))
        .filter((entry) => entry.startsWith("v"))
        .toSorted(),
    ).toEqual(["v1.0.0", "v1.0.1"])
    expect(existsSync(join(workspace, ".release-site.backup"))).toBeFalse()
    expect(existsSync(join(workspace, ".release-site.lock"))).toBeFalse()
    expect(
      readdirSync(workspace).filter((entry) => entry.startsWith(".release-site.stage-")),
    ).toEqual([])
  })
})
