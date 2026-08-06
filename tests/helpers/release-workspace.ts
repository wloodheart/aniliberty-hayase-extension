import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function createReleaseWorkspace(prefix: string): string {
  const workspace = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(workspace, "dist"))
  mkdirSync(join(workspace, "assets"))
  writeFileSync(join(workspace, "dist", "aniliberty.mjs"), "export default Object.freeze({})\n")
  writeFileSync(join(workspace, "assets", "aniliberty-neutral.svg"), "<svg></svg>\n")
  return workspace
}
