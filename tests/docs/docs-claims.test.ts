import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { validateDocument } from "./docs-claim-rules.ts"

const root = join(import.meta.dir, "../..")

type PackageMetadata = {
  readonly scripts: Readonly<Record<string, string>>
}

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
}

test.each([
  ["affiliation.md", "AFFILIATION_CLAIM"],
  ["accuracy.md", "ACCURACY_CLAIM"],
  ["hls.md", "HLS_CLAIM"],
  ["moving-url.md", "MOVING_ARTIFACT_URL"],
  ["unknown-script.md", "UNKNOWN_SCRIPT:missing-script"],
  ["checksum.md", "HAYASE_CHECKSUM_CLAIM"],
  ["normalized-title.md", "NORMALIZED_TITLE_DISCLOSURE"],
  ["security-fallback.md", "INACCESSIBLE_SECURITY_FALLBACK"],
] as const)("reports only %s documentation violation", (fixture, code) => {
  // Given: one fixture containing exactly one unsafe claim
  const metadata: PackageMetadata = JSON.parse(read("package.json"))
  const path = `tests/fixtures/docs/${fixture}`

  // When: the single fixture is validated
  const violations = validateDocument(read(path), path, new Set(Object.keys(metadata.scripts)))

  // Then: no other detector can hide or satisfy this violation
  expect(violations).toEqual([{ code, path }])
})
