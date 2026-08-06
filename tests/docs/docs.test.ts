import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

const root = join(import.meta.dir, "../..")
const requiredDocuments = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/maintenance.md",
] as const
const requiredReadmeSections = [
  "Status and scope",
  "Installation",
  "Updates and trust",
  "Behavior",
  "Privacy and security",
  "Troubleshooting",
  "Legal boundaries",
] as const
const requiredMaintenanceSections = [
  "Supported contracts",
  "Fixture refresh",
  "Contract drift response",
  "Release checklist",
  "Atomic publication and provenance",
  "Rollback",
  "Support matrix",
] as const

type PackageMetadata = {
  readonly scripts: Readonly<Record<string, string>>
}

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
}

function headingExists(markdown: string, heading: string): boolean {
  return new RegExp(`^#{1,6} ${heading}$`, "imu").test(markdown)
}

function readmeViolations(markdown: string, scripts: ReadonlySet<string>): readonly string[] {
  const violations: string[] = []
  if (/\bofficial (?:extension|integration|project|source)\b/iu.test(markdown)) {
    violations.push("AFFILIATION_CLAIM")
  }
  if (/\b(?:high|perfect) accuracy\b/iu.test(markdown)) violations.push("ACCURACY_CLAIM")
  if (/\b(?:supports?|provides?|includes?) HLS\b|\bHLS support\b/iu.test(markdown)) {
    violations.push("HLS_CLAIM")
  }
  if (/raw\.githubusercontent\.com|\/refs\/heads\/|\/blob\/main\//iu.test(markdown)) {
    violations.push("MOVING_ARTIFACT_URL")
  }
  if (
    /https:\/\/(?:example|owner)\.github\.io|--repository\s+(?:example|owner)\//iu.test(markdown)
  ) {
    violations.push("PLACEHOLDER_INSTALL_URL")
  }
  const commands = markdown.matchAll(/\bbun run ([a-z][\w:-]*)/gu)
  for (const command of commands) {
    const script = command[1]
    if (script !== undefined && !scripts.has(script)) {
      violations.push(`UNKNOWN_SCRIPT:${script}`)
    }
  }
  return violations
}

function localCommands(markdown: string): readonly string[] {
  return Array.from(markdown.matchAll(/```sh local\n([\s\S]*?)```/gu), (match) => match[1] ?? "")
    .flatMap((block) => block.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function relativeLinks(markdown: string): readonly string[] {
  return Array.from(
    markdown.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/gu),
    (match) => (match[1] ?? "").split("#", 1)[0] ?? "",
  ).filter((path) => path.length > 0)
}

describe("project documentation contract", () => {
  test("provides every required document", () => {
    // Given: the Task 13 documentation surface
    // When: required paths are resolved from the repository root
    const missing = requiredDocuments.filter((path) => !existsSync(join(root, path)))

    // Then: the complete user and maintainer document set exists
    expect(missing).toEqual([])
  })

  test("documents supported behavior without unsafe claims", () => {
    // Given: package scripts and the user README
    const metadata: PackageMetadata = JSON.parse(read("package.json"))
    const readme = read("README.md")

    // When: claims and command names are validated
    const violations = readmeViolations(readme, new Set(Object.keys(metadata.scripts)))

    // Then: required boundaries are present and forbidden claims are absent
    expect(violations).toEqual([])
    expect(requiredReadmeSections.filter((heading) => !headingExists(readme, heading))).toEqual([])
    expect(readme).toContain("https://<owner>.github.io/<repository>/index.json")
    expect(readme).toContain("vMAJOR.MINOR.PATCH/aniliberty.mjs")
    expect(readme).toContain("https://aniliberty.top/api/v1/app/status")
    expect(readme).toContain("https://aniliberty.top/api/v1/app/search/releases?query=")
    expect(readme).toContain("https://aniliberty.top/api/v1/anime/torrents/release/{releaseId}")
    expect(readme).toContain("assets/aniliberty-neutral.svg")
    expect(readme).toContain("unofficial Hayase torrent source")
    expect(readme).toContain("torrent-only")
    expect(readme).toContain("Russian-dub")
    expect(readme).toContain("`medium` accuracy")
    expect(readme).toContain("no HLS playback")
    expect(readme).toContain("no telemetry")
    expect(readme).toContain("no-match result `[]`")
  })

  test("reports each unsafe fixture violation independently", () => {
    // Given: one README fixture containing every forbidden claim class
    const metadata: PackageMetadata = JSON.parse(read("package.json"))
    const fixture = read("tests/fixtures/docs/invalid-readme.md")

    // When: the fixture is validated without fail-fast behavior
    const violations = readmeViolations(fixture, new Set(Object.keys(metadata.scripts)))

    // Then: every independent violation is reported
    expect(violations).toEqual([
      "AFFILIATION_CLAIM",
      "ACCURACY_CLAIM",
      "HLS_CLAIM",
      "MOVING_ARTIFACT_URL",
      "UNKNOWN_SCRIPT:missing-script",
    ])
  })

  test("keeps local command blocks tied to package scripts", () => {
    // Given: all fenced local commands and current package scripts
    const metadata: PackageMetadata = JSON.parse(read("package.json"))
    const markdown = requiredDocuments
      .filter((path) => path.endsWith(".md"))
      .map(read)
      .join("\n")

    // When: command blocks are parsed
    const commands = localCommands(markdown)
    const referencedScripts = commands.flatMap((command) =>
      Array.from(command.matchAll(/\bbun run ([a-z][\w:-]*)/gu), (match) => match[1] ?? ""),
    )

    // Then: required commands are real and no stale package script is named
    expect(commands).toContain("bun install --frozen-lockfile")
    expect(commands).toContain("bun run check")
    expect(referencedScripts).toContain("release:dry-run")
    expect(referencedScripts.filter((script) => !(script in metadata.scripts))).toEqual([])
  })

  test("keeps relative documentation links resolvable", () => {
    // Given: every Markdown document in the required surface
    const documents = requiredDocuments.filter((path) => path.endsWith(".md"))

    // When: relative links are resolved from each document
    const broken = documents.flatMap((document) =>
      relativeLinks(read(document))
        .map((link) => normalize(join(dirname(document), link)))
        .filter((link) => !existsSync(join(root, link))),
    )

    // Then: all linked repository paths exist
    expect(broken).toEqual([])
  })

  test("records maintenance, security, legal, and release boundaries", () => {
    // Given: the maintainer, security, and legal documents
    const maintenance = read("docs/maintenance.md")
    const security = read("SECURITY.md")
    const license = read("LICENSE")

    // When: stable operational markers are inspected
    const missingHeadings = requiredMaintenanceSections.filter(
      (heading) => !headingExists(maintenance, heading),
    )

    // Then: machine-relevant contracts and policies are explicit
    expect(missingHeadings).toEqual([])
    expect(maintenance).toContain("56151c710a9265f42994bd72cff007598c596bab")
    expect(maintenance).toContain("PASS_API_OK")
    expect(maintenance).toContain("SKIP_ENV_BLOCKED_403")
    expect(maintenance).toContain("SKIP_ENV_NETWORK")
    expect(maintenance).toContain("SKIP_ENV_TRANSIENT_HTTP")
    expect(maintenance).toContain("FAIL_ENDPOINT_DRIFT")
    expect(maintenance).toContain("FAIL_SCHEMA_DRIFT")
    expect(security).toContain("private vulnerability reporting")
    expect(security).toContain("Don't disclose")
    expect(license).toContain("Permission is hereby granted, free of charge")
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })
})
