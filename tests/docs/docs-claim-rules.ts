import { readFileSync } from "node:fs"
import { join } from "node:path"

interface PhraseRule {
  readonly code: string
  readonly phrases: readonly string[]
}

function parsePhraseRule(value: unknown): PhraseRule {
  if (typeof value !== "object" || value === null)
    throw new TypeError("claim rule must be an object")
  const code = Reflect.get(value, "code")
  const phrases = Reflect.get(value, "phrases")
  if (typeof code !== "string") throw new TypeError("claim rule code must be a string")
  if (!Array.isArray(phrases) || !phrases.every((phrase: unknown) => typeof phrase === "string")) {
    throw new TypeError("claim rule phrases must be strings")
  }
  return { code, phrases }
}

function loadPhraseRules(path: string): readonly PhraseRule[] {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(value)) throw new TypeError("claim rules must be an array")
  return value.map(parsePhraseRule)
}

const phraseRules = loadPhraseRules(join(import.meta.dir, "../fixtures/docs/claim-rules.json"))

export function normalizedSentences(markdown: string): readonly string[] {
  return markdown
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("\n", " ")
    .split(".")
    .map((sentence) =>
      sentence
        .split(" ")
        .filter((part) => part.length > 0)
        .join(" ")
        .trim(),
    )
}

export function claimViolations(markdown: string): readonly string[] {
  const sentences = normalizedSentences(markdown)
  const text = markdown.normalize("NFKC").toLowerCase().replaceAll("\n", " ")
  const violations: string[] = []
  for (const rule of phraseRules) {
    if (rule.phrases.some((phrase) => text.includes(phrase))) violations.push(rule.code)
  }
  if (
    text.includes("raw.githubusercontent.com") ||
    text.includes("/refs/heads/") ||
    (text.includes("github.com/") && (text.includes("/blob/") || text.includes("/tree/")))
  )
    violations.push("MOVING_ARTIFACT_URL")
  const claimsHayaseChecksIntegrity = sentences.some(
    (sentence) =>
      ["hayase verifies", "hayase enforces", "hayase validates", "hayase checks"].some((phrase) =>
        sentence.includes(phrase),
      ) && ["sha-256", "sha256", "checksum", "digest"].some((phrase) => sentence.includes(phrase)),
  )
  if (claimsHayaseChecksIntegrity) violations.push("HAYASE_CHECKSUM_CLAIM")
  if (
    sentences.some(
      (sentence) =>
        sentence.includes("normalized title") &&
        (sentence.includes("aniliberty receives") ||
          sentence.includes("endpoint receives") ||
          sentence.includes("sent to aniliberty")),
    )
  )
    violations.push("NORMALIZED_TITLE_DISCLOSURE")
  return violations
}

export function validateDocument(
  markdown: string,
  path: string,
  scripts: ReadonlySet<string>,
): readonly { readonly code: string; readonly path: string }[] {
  const violations = claimViolations(markdown).map((code) => ({ code, path }))
  const lower = markdown.toLowerCase()
  if (
    lower.includes("https://example.github.io") ||
    lower.includes("https://owner.github.io") ||
    lower.includes("--repository example/") ||
    lower.includes("--repository owner/")
  )
    violations.push({ code: "PLACEHOLDER_INSTALL_URL", path })
  for (const line of markdown.split("\n")) {
    const command = line.trim().split(" ")
    const script = command[0] === "bun" && command[1] === "run" ? command[2] : undefined
    if (script !== undefined && !scripts.has(script)) {
      violations.push({ code: `UNKNOWN_SCRIPT:${script}`, path })
    }
  }
  return violations
}
