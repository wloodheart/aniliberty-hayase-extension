import { collectTypeScriptFiles } from "./collect-typescript-files.ts"
import { collectNoExcuseViolations } from "./no-excuse.ts"

const defaultPaths = ["scripts", "src", "tests"]

const paths = Bun.argv.slice(2)
const files = (paths.length === 0 ? defaultPaths : paths).flatMap(collectTypeScriptFiles)
const violations = await collectNoExcuseViolations(files)

for (const violation of violations) {
  console.error(
    `${violation.filePath}:${violation.line}:${violation.column} no-excuse/${violation.rule}`,
  )
}

if (violations.length === 0) {
  const typecheck = Bun.spawn(
    paths.length === 0
      ? ["bun", "x", "tsc", "--noEmit"]
      : ["bun", "x", "tsc", "--noEmit", "--ignoreConfig", ...files],
    {
      stderr: "inherit",
      stdout: "inherit",
    },
  )

  process.exitCode = await typecheck.exited
} else {
  process.exitCode = 1
}
