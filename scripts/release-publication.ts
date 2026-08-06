import { closeSync, existsSync, openSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

export type PublicationOperations = {
  readonly rename: (source: string, destination: string) => void
  readonly removeBackup?: (backupPath: string) => void
}

export type RecoveryPaths = {
  readonly siteDirectory: string
  readonly backupDirectory: string
}

export type PublicationPaths = RecoveryPaths & {
  readonly stagedSiteDirectory: string
}

const DEFAULT_PUBLICATION_OPERATIONS = Object.freeze({
  rename: renameSync,
  removeBackup: (backupPath: string): void => rmSync(backupPath, { recursive: true }),
})

export class ReleaseLockedError extends Error {
  readonly name = "ReleaseLockedError"

  constructor(readonly lockPath: string) {
    super(`Another release publication holds the filesystem lock: ${lockPath}`)
  }
}

export class ReleasePublicationError extends Error {
  readonly name = "ReleasePublicationError"

  constructor(
    readonly targetPath: string,
    cause: unknown,
  ) {
    super(`Release publication failed for: ${targetPath}`, { cause })
  }
}

export class ReleaseRollbackError extends Error {
  readonly name = "ReleaseRollbackError"

  constructor(
    readonly backupPath: string,
    readonly publicationFailure: unknown,
    cause: unknown,
  ) {
    super(`Release rollback failed; previous site retained at: ${backupPath}`, { cause })
  }
}

export class ReleaseRollbackPendingError extends Error {
  readonly name = "ReleaseRollbackPendingError"

  constructor(
    readonly sitePath: string,
    readonly backupPath: string,
  ) {
    super(`Release rollback remains pending; recover ${backupPath} to ${sitePath}`)
  }
}

export class ReleaseCommittedCleanupError extends Error {
  readonly name = "ReleaseCommittedCleanupError"

  constructor(
    readonly sitePath: string,
    readonly backupPath: string,
    cause: unknown,
  ) {
    super(`Release committed at ${sitePath}; backup cleanup failed at ${backupPath}`, { cause })
  }
}

function acquireReleaseLock(workspace: string): {
  readonly descriptor: number
  readonly path: string
} {
  const path = join(workspace, ".release-site.lock")
  try {
    return { descriptor: openSync(path, "wx"), path }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new ReleaseLockedError(path)
    }
    throw error
  }
}

function releaseLock(descriptor: number, path: string): void {
  try {
    closeSync(descriptor)
  } finally {
    rmSync(path, { force: true })
  }
}

export async function withReleaseLock(
  workspace: string,
  operation: () => Promise<void>,
): Promise<void> {
  const lock = acquireReleaseLock(workspace)
  try {
    await operation()
  } finally {
    releaseLock(lock.descriptor, lock.path)
  }
}

export function withReleaseLockSync(workspace: string, operation: () => void): void {
  const lock = acquireReleaseLock(workspace)
  try {
    operation()
  } finally {
    releaseLock(lock.descriptor, lock.path)
  }
}

export function recoverPublicationState(
  paths: RecoveryPaths,
  operations: PublicationOperations = DEFAULT_PUBLICATION_OPERATIONS,
): void {
  if (!existsSync(paths.backupDirectory)) {
    return
  }

  if (!existsSync(paths.siteDirectory)) {
    throw new ReleaseRollbackPendingError(paths.siteDirectory, paths.backupDirectory)
  }

  try {
    const removeBackup = operations.removeBackup ?? DEFAULT_PUBLICATION_OPERATIONS.removeBackup
    removeBackup(paths.backupDirectory)
  } catch (error) {
    throw new ReleaseCommittedCleanupError(paths.siteDirectory, paths.backupDirectory, error)
  }
}

export function publishStagedSite(
  paths: PublicationPaths,
  operations: PublicationOperations = DEFAULT_PUBLICATION_OPERATIONS,
): void {
  if (existsSync(paths.backupDirectory)) {
    if (!existsSync(paths.siteDirectory)) {
      throw new ReleaseRollbackPendingError(paths.siteDirectory, paths.backupDirectory)
    }
    throw new ReleaseCommittedCleanupError(paths.siteDirectory, paths.backupDirectory, undefined)
  }

  if (!existsSync(paths.siteDirectory)) {
    try {
      operations.rename(paths.stagedSiteDirectory, paths.siteDirectory)
      return
    } catch (error) {
      throw new ReleasePublicationError(paths.siteDirectory, error)
    }
  }

  try {
    operations.rename(paths.siteDirectory, paths.backupDirectory)
  } catch (error) {
    throw new ReleasePublicationError(paths.siteDirectory, error)
  }

  try {
    operations.rename(paths.stagedSiteDirectory, paths.siteDirectory)
  } catch (publicationFailure) {
    try {
      operations.rename(paths.backupDirectory, paths.siteDirectory)
    } catch (rollbackFailure) {
      throw new ReleaseRollbackError(paths.backupDirectory, publicationFailure, rollbackFailure)
    }
    throw new ReleasePublicationError(paths.siteDirectory, publicationFailure)
  }

  try {
    const removeBackup = operations.removeBackup ?? DEFAULT_PUBLICATION_OPERATIONS.removeBackup
    removeBackup(paths.backupDirectory)
  } catch (error) {
    throw new ReleaseCommittedCleanupError(paths.siteDirectory, paths.backupDirectory, error)
  }
}
