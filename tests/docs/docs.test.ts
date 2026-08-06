import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { normalizedSentences, validateDocument } from "./docs-claim-rules.ts"

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

function markdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n")
  const index = lines.indexOf(`## ${heading}`)
  if (index < 0) return null
  const section: string[] = []
  for (const line of lines.slice(index + 1)) {
    if (line.startsWith("# ") || line.startsWith("## ")) break
    section.push(line)
  }
  return section.join("\n").trim()
}

function requiredMarkdownDocuments(): readonly {
  readonly markdown: string
  readonly path: string
}[] {
  return requiredDocuments
    .filter((path) => path.endsWith(".md"))
    .map((path) => ({ markdown: read(path), path }))
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
    const documents = requiredMarkdownDocuments()
    const readme = read("README.md")

    // When: every required Markdown document is validated
    const scripts = new Set(Object.keys(metadata.scripts))
    const violations = documents.flatMap((document) =>
      validateDocument(document.markdown, document.path, scripts),
    )

    // Then: required boundaries are present and forbidden claims are absent
    expect(violations).toEqual([])
    expect(
      requiredReadmeSections.filter((heading) => markdownSection(readme, heading) === null),
    ).toEqual([])
    const installation = markdownSection(readme, "Installation") ?? ""
    const status = markdownSection(readme, "Status and scope") ?? ""
    const privacy = markdownSection(readme, "Privacy and security") ?? ""
    expect(installation).toContain("https://<owner>.github.io/<repository>/index.json")
    expect(installation).toContain("vMAJOR.MINOR.PATCH/aniliberty.mjs")
    expect(installation).toContain("pinned Hayase does not enforce the SHA-256")
    expect(installation).toContain("repository tooling")
    expect(status).toContain("unofficial Hayase torrent source")
    expect(status).toContain("torrent-only")
    expect(status).toContain("Russian-dub")
    expect(status).toContain("`medium` accuracy")
    expect(status).toContain("no HLS playback")
    expect(privacy).toContain("https://aniliberty.top/api/v1/app/status")
    expect(privacy).toContain("https://aniliberty.top/api/v1/app/search/releases?query=")
    expect(privacy).toContain("https://aniliberty.top/api/v1/anime/torrents/release/{releaseId}")
    expect(normalizedSentences(privacy).join(" ")).toContain("trimmed original hayase titles")
    expect(privacy).toContain("case and punctuation")
    expect(privacy).toContain("no telemetry")
  })

  test("records maintenance, security, legal, and release boundaries", () => {
    // Given: the maintainer, security, and legal documents
    const maintenance = read("docs/maintenance.md")
    const security = read("SECURITY.md")
    const license = read("LICENSE")

    // When: stable operational markers are inspected
    const missingHeadings = requiredMaintenanceSections.filter(
      (heading) => markdownSection(maintenance, heading) === null,
    )

    // Then: machine-relevant contracts and policies are explicit
    expect(missingHeadings).toEqual([])
    const support = markdownSection(maintenance, "Support matrix") ?? ""
    const drift = markdownSection(maintenance, "Contract drift response") ?? ""
    const rollback = markdownSection(maintenance, "Rollback") ?? ""
    const reporting = markdownSection(security, "Report a vulnerability") ?? ""
    expect(support).toContain("56151c710a9265f42994bd72cff007598c596bab")
    for (const token of [
      "PASS_API_OK",
      "SKIP_ENV_BLOCKED_403",
      "SKIP_ENV_NETWORK",
      "SKIP_ENV_TRANSIENT_HTTP",
      "FAIL_ENDPOINT_DRIFT",
      "FAIL_SCHEMA_DRIFT",
    ])
      expect(drift).toContain(token)
    expect(rollback).toContain("workflow_dispatch")
    expect(reporting).toContain("private vulnerability reporting")
    expect(reporting).toContain("Don't disclose")
    expect(license).toContain("Permission is hereby granted, free of charge")
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })
})
