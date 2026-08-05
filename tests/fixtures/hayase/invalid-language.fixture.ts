import type { HayaseManifestV2 } from "../../../src/hayase/types.ts"

const invalidLanguages: ["INVALID"] = ["INVALID"]

const acceptsLanguages = (languages: HayaseManifestV2["languages"]): void => {
  void languages
}

acceptsLanguages(invalidLanguages)
