import { readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"

export function collectTypeScriptFiles(path: string): readonly string[] {
  if (statSync(path).isFile()) {
    return extname(path) === ".ts" ? [path] : []
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name)

    return entry.isDirectory()
      ? collectTypeScriptFiles(entryPath)
      : extname(entryPath) === ".ts"
        ? [entryPath]
        : []
  })
}
