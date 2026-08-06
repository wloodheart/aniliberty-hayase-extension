import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { ReleaseWorkspace } from "./artifacts.ts"

const ManifestSchema = z.array(
  z.object({
    manifestVersion: z.literal(2),
    version: z.string(),
    id: z.literal("aniliberty.torrents"),
    type: z.literal("torrent"),
    code: z.string(),
    sha256: z.string(),
  }),
)

export class ReleaseCompatibilityError extends Error {
  readonly name = "ReleaseCompatibilityError"

  constructor(message: string) {
    super(message)
    this.stack = `${this.name}: ${message}`
  }
}

export function loadReleaseArtifact(workspace: ReleaseWorkspace): Uint8Array {
  const manifestPath = join(workspace.path, ".release-site", "index.json")
  const parsed = ManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")))
  if (!parsed.success || parsed.data.length !== 1) {
    throw new ReleaseCompatibilityError("Release manifest structure is incompatible")
  }
  const manifest = parsed.data[0]
  if (manifest === undefined || manifest.version !== workspace.version) {
    throw new ReleaseCompatibilityError("Release manifest version mismatch")
  }
  const expectedCode = `https://example.github.io/aniliberty/v${workspace.version}/aniliberty.mjs`
  if (manifest.code !== expectedCode) {
    throw new ReleaseCompatibilityError("Release manifest code URL mismatch")
  }
  const artifact = readFileSync(
    join(workspace.path, ".release-site", `v${workspace.version}`, "aniliberty.mjs"),
  )
  if (createHash("sha256").update(artifact).digest("hex") !== manifest.sha256) {
    throw new ReleaseCompatibilityError("Release artifact checksum mismatch")
  }
  return Uint8Array.from(artifact)
}
