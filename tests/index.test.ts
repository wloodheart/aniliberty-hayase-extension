import { expect, test } from "bun:test"

import extensionEntrypoint from "../src/index.ts"

test("provides the initial extension entrypoint", () => {
  // Given: the standalone extension module
  // When: its public entrypoint is imported
  // Then: it exposes an intentionally empty Worker boundary
  expect(extensionEntrypoint).toEqual({})
})
