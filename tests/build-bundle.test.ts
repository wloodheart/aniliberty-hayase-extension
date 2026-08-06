import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildProductionBundle, ProductionBuildError } from "../scripts/build-bundle.ts"

const workspace = join(import.meta.dir, "..")
const bundlePath = join(workspace, "dist", "aniliberty.mjs")

test("builds a deterministic production browser ESM artifact", async () => {
  // Given: a clean production output directory
  rmSync(join(workspace, "dist"), { force: true, recursive: true })

  // When: two independent production builds run
  const firstBuild = Bun.spawn(["bun", "run", "build"], { cwd: workspace, stderr: "pipe" })
  const firstExitCode = await firstBuild.exited
  const firstError = await new Response(firstBuild.stderr).text()
  const firstBytes = existsSync(bundlePath) ? readFileSync(bundlePath) : Buffer.alloc(0)
  const secondBuild = Bun.spawn(["bun", "run", "build"], { cwd: workspace, stderr: "pipe" })
  const secondExitCode = await secondBuild.exited
  const secondError = await new Response(secondBuild.stderr).text()
  const secondBytes = existsSync(bundlePath) ? readFileSync(bundlePath) : Buffer.alloc(0)

  // Then: only the named production artifact exists and its bytes are reproducible
  expect(firstExitCode, firstError).toBe(0)
  expect(secondExitCode, secondError).toBe(0)
  expect(firstBytes.byteLength).toBeGreaterThan(0)
  expect(secondBytes).toEqual(firstBytes)
  expect(createHash("sha256").update(secondBytes).digest("hex")).toBe(
    createHash("sha256").update(firstBytes).digest("hex"),
  )
  expect(existsSync(join(workspace, "dist", "index.js"))).toBeFalse()
})

test("cleans stale and partial output when production bundling fails", async () => {
  // Given: invalid source and stale production output in an isolated workspace
  const temporaryWorkspace = mkdtempSync(join(tmpdir(), "aniliberty-build-failure-"))
  mkdirSync(join(temporaryWorkspace, "src"))
  mkdirSync(join(temporaryWorkspace, "dist"))
  writeFileSync(join(temporaryWorkspace, "src", "index.ts"), "export default {\n")
  writeFileSync(join(temporaryWorkspace, "dist", "stale.mjs"), "stale")

  try {
    // When: the production build fails
    const build = buildProductionBundle(temporaryWorkspace)

    // Then: it reports the build failure and removes all generated output
    expect(build).rejects.toBeInstanceOf(ProductionBuildError)
    await build.catch(() => undefined)
    expect(existsSync(join(temporaryWorkspace, "dist"))).toBeFalse()
    expect(
      readdirSync(temporaryWorkspace).filter((entry) => entry.startsWith(".dist-stage-")),
    ).toEqual([])
  } finally {
    rmSync(temporaryWorkspace, { force: true, recursive: true })
  }
})
