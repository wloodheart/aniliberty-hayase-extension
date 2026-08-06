import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MissingBundleArtifactError, verifyBundleArtifact } from "../scripts/verify-bundle.ts"

test("accepts a built bundle file", async () => {
  // Given: an isolated bundle file
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-"))
  const bundlePath = join(temporaryDirectory, "index.js")
  writeFileSync(
    bundlePath,
    [
      '// import "node:fs"',
      'const marker = "import(\\"node:fs\\")"',
      "export default { marker, test() {}, single() {}, batch() {}, movie() {} }",
      "",
    ].join("\n"),
  )

  try {
    // When: the bundle verifier receives the file
    await verifyBundleArtifact(bundlePath)

    // Then: the artifact is accepted
    expect(true).toBeTrue()
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test("rejects a named-only export with a specific diagnostic", async () => {
  // Given: an inert bundle fixture without a default export
  const bundlePath = join(import.meta.dir, "fixtures", "bundle", "named-only.mjs")

  // When: the verifier inspects its module structure
  const verification = verifyBundleArtifact(bundlePath)

  // Then: it reports the export contract without importing the fixture
  expect(verification).rejects.toThrow("Bundle must export only a default value; found: source")
})

test("rejects a runtime import before executing the imported module", async () => {
  // Given: a fixture whose dynamic dependency throws if evaluated
  const bundlePath = join(import.meta.dir, "fixtures", "bundle", "runtime-import.mjs")

  // When: the verifier inspects its module structure
  const verification = verifyBundleArtifact(bundlePath)

  // Then: it reports the import itself rather than executing the dependency
  expect(verification).rejects.toThrow(
    "Bundle contains forbidden dynamic-import: ./must-not-execute.mjs",
  )
})

test("rejects a runtime re-export without evaluating its dependency", async () => {
  // Given: an inert fixture that re-exports another module
  const bundlePath = join(import.meta.dir, "fixtures", "bundle", "runtime-reexport.mjs")

  // When: the verifier inspects its module structure
  const verification = verifyBundleArtifact(bundlePath)

  // Then: the re-export dependency is reported as a runtime import
  expect(verification).rejects.toThrow(
    "Bundle contains forbidden import-statement: ./named-only.mjs",
  )
})

test.each([
  { diagnostic: "source map reference", embedded: "//# sourceMappingURL=bundle.mjs.map" },
  { diagnostic: "source map data", embedded: 'const leaked = { "sources": ["src/index.ts"] }' },
  { diagnostic: "query fixture text", embedded: 'const leaked = "Hell Mode"' },
  {
    diagnostic: "absolute project path",
    embedded: `const leaked = ${JSON.stringify(process.cwd())}`,
  },
  { diagnostic: "absolute temporary path", embedded: `const leaked = ${JSON.stringify(tmpdir())}` },
  {
    diagnostic: "mutable raw GitHub branch URL",
    embedded: 'const leaked = "https://raw.githubusercontent.com/example/aniliberty/main/file"',
  },
])("rejects forbidden bundle content: $diagnostic", async ({ diagnostic, embedded }) => {
  // Given: an otherwise valid bundle containing forbidden release data
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-content-"))
  const bundlePath = join(temporaryDirectory, "aniliberty.mjs")
  writeFileSync(
    bundlePath,
    `${embedded}\nexport default { test() {}, single() {}, batch() {}, movie() {} }\n`,
  )

  try {
    // When: the verifier inspects the bundle bytes
    const verification = verifyBundleArtifact(bundlePath)

    // Then: the forbidden content category is reported without echoing its value
    expect(verification).rejects.toThrow(diagnostic)
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
})

test("rejects a default-exported constructor instead of an object instance", async () => {
  // Given: a bundle whose default value is a class constructor
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "aniliberty-bundle-constructor-"))
  const bundlePath = join(temporaryDirectory, "aniliberty.mjs")
  writeFileSync(bundlePath, "export default class Source {}\n")

  try {
    // When: the verifier imports the structurally safe module
    const verification = verifyBundleArtifact(bundlePath)

    // Then: it requires an instantiated object
    expect(verification).rejects.toThrow("Bundle default export must be an instantiated object")
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
