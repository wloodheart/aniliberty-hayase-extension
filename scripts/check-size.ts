import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"

const warningLineCount = 200
const maximumLineCount = 250
const defaultPaths = ["scripts", "src", "tests"]

function collectTypeScriptFiles(path: string): readonly string[] {
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

function countSourceLines(filePath: string): number {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmedLine = line.trim()

      return (
        trimmedLine.length > 0 &&
        !trimmedLine.startsWith("//") &&
        !trimmedLine.startsWith("/*") &&
        !trimmedLine.startsWith("*") &&
        !trimmedLine.startsWith("*/")
      )
    }).length
}

const paths = Bun.argv.slice(2)
const files = (paths.length === 0 ? defaultPaths : paths).flatMap(collectTypeScriptFiles)
const failures: string[] = []

for (const filePath of files) {
  const lineCount = countSourceLines(filePath)

  if (lineCount > maximumLineCount) {
    failures.push(`${filePath}: ${lineCount} source lines exceeds ${maximumLineCount}`)
  } else if (lineCount >= warningLineCount) {
    console.warn(
      `${filePath}: ${lineCount} source lines is in the ${warningLineCount}-${maximumLineCount} warning band`,
    )
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exitCode = 1
}
