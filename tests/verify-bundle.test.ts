import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MissingBundleArtifactError, verifyBundleArtifact } from "../scripts/verify-bundle.ts"

test("accepts a built bundle file", async () => {
  // Given: an isolated bundle file
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-"))
  const bundlePath = join(temporaryDirectory, "index.js")
  writeFileSync(bundlePath, "export default {}\n")

  try {
    // When: the bundle verifier receives the file
    await verifyBundleArtifact(bundlePath)

    // Then: the artifact is accepted
    expect(true).toBeTrue()
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test("rejects a missing bundle file", async () => {
  // Given: an isolated path without a bundle
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-"))

  try {
    // When: the bundle verifier receives the missing path
    const verification = verifyBundleArtifact(join(temporaryDirectory, "index.js"))

    // Then: it identifies the missing artifact
    let error: unknown

    try {
      await verification
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(MissingBundleArtifactError)
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test("rejects a directory in place of a bundle file", async () => {
  // Given: an isolated directory at the expected bundle path
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-"))
  const bundlePath = join(temporaryDirectory, "index.js")
  mkdirSync(bundlePath)

  try {
    // When: the bundle verifier receives the directory
    const verification = verifyBundleArtifact(bundlePath)

    // Then: it requires a regular file
    let error: unknown

    try {
      await verification
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(MissingBundleArtifactError)
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})
