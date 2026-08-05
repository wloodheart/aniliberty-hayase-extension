import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { collectNoExcuseViolations } from "../scripts/no-excuse.ts"

function createSourceFixture(source: string): {
  readonly directory: string
  readonly filePath: string
} {
  const directory = mkdtempSync(join(tmpdir(), "aniliberty-no-excuse-"))
  const filePath = join(directory, "fixture.ts")
  writeFileSync(filePath, source)

  return { directory, filePath }
}

test("accepts valid TypeScript source", async () => {
  // Given: an isolated valid source file
  const fixture = createSourceFixture("export const count = 1\n")

  try {
    // When: the no-excuse checker parses the source
    const violations = await collectNoExcuseViolations([fixture.filePath])

    // Then: it reports no violations
    expect(violations).toEqual([])
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test("reports explicit any when a declaration uses it", async () => {
  // Given: an isolated standalone explicit-any declaration
  const fixture = createSourceFixture("export const unsafe: any = 1\n")

  try {
    // When: the no-excuse checker parses the source
    const violations = await collectNoExcuseViolations([fixture.filePath])

    // Then: it reports the explicit-any rule directly
    expect(violations.map((violation) => violation.rule)).toEqual(["explicit-any"])
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test("reports forbidden assertion and suppression forms", async () => {
  // Given: an isolated source file with forbidden assertion and suppression forms
  const fixture = createSourceFixture(
    [
      "// @ts-ignore",
      "// @ts-expect-error",
      "const asserted = value as any",
      "const unknownValue = value as unknown",
      "const present = value!",
    ].join("\n"),
  )

  try {
    // When: the no-excuse checker parses the source
    const violations = await collectNoExcuseViolations([fixture.filePath])

    // Then: each form has a dedicated diagnostic
    expect(violations.map((violation) => violation.rule)).toEqual([
      "ts-ignore",
      "ts-expect-error",
      "as-any",
      "as-unknown",
      "non-null-assertion",
    ])
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test("ignores forbidden-looking comment and string content", async () => {
  // Given: an isolated source file with forbidden-looking prose but no violation
  const fixture = createSourceFixture(
    [
      "// This documentation mentions any, value!, and as unknown.",
      'export const message = "@ts-ignore and value as any"',
    ].join("\n"),
  )

  try {
    // When: the no-excuse checker parses the source
    const violations = await collectNoExcuseViolations([fixture.filePath])

    // Then: it reports no false positives
    expect(violations).toEqual([])
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})
