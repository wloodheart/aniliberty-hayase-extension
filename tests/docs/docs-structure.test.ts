import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

const root = join(import.meta.dir, "../..")
const documents = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/maintenance.md",
] as const

type PackageMetadata = { readonly scripts: Readonly<Record<string, string>> }

function read(path: string): string {
  return readFileSync(join(root, path), "utf8")
}

function localCommands(markdown: string): readonly string[] {
  const commands: string[] = []
  let local = false
  for (const line of markdown.split("\n")) {
    if (line === "```sh local") local = true
    else if (line === "```") local = false
    else if (local && line.trim().length > 0) commands.push(line.trim())
  }
  return commands
}

function relativeLinks(markdown: string): readonly string[] {
  const links: string[] = []
  let offset = 0
  while (offset < markdown.length) {
    const start = markdown.indexOf("](", offset)
    if (start < 0) break
    const end = markdown.indexOf(")", start + 2)
    if (end < 0) break
    const target = markdown.slice(start + 2, end).split("#", 1)[0] ?? ""
    if (target.length > 0 && !target.startsWith("http") && !target.startsWith("#"))
      links.push(target)
    offset = end + 1
  }
  return links
}

test("keeps local command blocks tied to package scripts", () => {
  // Given: all fenced local commands and current package scripts
  const metadata: PackageMetadata = JSON.parse(read("package.json"))
  const markdown = documents.map(read).join("\n")

  // When: command blocks are parsed
  const commands = localCommands(markdown)
  const scripts = commands.flatMap((command) => {
    const parts = command.split(" ")
    return parts[0] === "bun" && parts[1] === "run" && parts[2] !== undefined ? [parts[2]] : []
  })

  // Then: required commands are real and no stale package script is named
  expect(commands).toContain("bun install --frozen-lockfile")
  expect(commands).toContain("bun run check")
  expect(scripts).toContain("release:dry-run")
  expect(scripts).toContain("release:workflow")
  expect(scripts.filter((script) => !(script in metadata.scripts))).toEqual([])
})

test("keeps relative documentation links resolvable", () => {
  // Given: every required Markdown document
  // When: relative links are resolved from each document
  const broken = documents.flatMap((document) =>
    relativeLinks(read(document))
      .map((link) => normalize(join(dirname(document), link)))
      .filter((link) => !existsSync(join(root, link))),
  )

  // Then: all linked repository paths exist
  expect(broken).toEqual([])
})
