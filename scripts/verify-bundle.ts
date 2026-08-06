import { statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const REQUIRED_METHODS = ["test", "single", "batch", "movie"] as const
const QUERY_FIXTURE_TEXT = ["Hell Mode"] as const

export class MissingBundleArtifactError extends Error {
  readonly name = "MissingBundleArtifactError"

  constructor(readonly filePath: string) {
    super(`Expected bundle artifact file at ${filePath}`)
  }
}

export class BundleVerificationError extends Error {
  readonly name = "BundleVerificationError"
}

function verifyModuleStructure(source: string): void {
  let module: ReturnType<Bun.Transpiler["scan"]>
  try {
    module = new Bun.Transpiler({ loader: "js" }).scan(source)
  } catch (error) {
    if (error instanceof Error) {
      throw new BundleVerificationError("Bundle contains invalid module syntax")
    }
    throw error
  }
  const runtimeImport = module.imports[0]
  if (runtimeImport !== undefined) {
    throw new BundleVerificationError(
      `Bundle contains forbidden ${runtimeImport.kind}: ${runtimeImport.path}`,
    )
  }

  const exports = [...new Set(module.exports)].toSorted()
  if (exports.length !== 1 || exports[0] !== "default") {
    throw new BundleVerificationError(
      `Bundle must export only a default value; found: ${exports.join(", ") || "none"}`,
    )
  }
}

function verifyForbiddenContent(source: string): void {
  const forbiddenLiterals = [
    { label: "source map reference", value: "sourceMappingURL" },
    { label: "mutable branch reference", value: "refs/heads/main" },
    { label: "absolute project path", value: process.cwd() },
    { label: "absolute temporary path", value: tmpdir() },
    ...QUERY_FIXTURE_TEXT.map((value) => ({ label: "query fixture text", value })),
  ] as const
  const forbiddenLiteral = forbiddenLiterals.find(({ value }) => source.includes(value))
  if (forbiddenLiteral !== undefined) {
    throw new BundleVerificationError(
      `Bundle contains forbidden embedded content: ${forbiddenLiteral.label}`,
    )
  }

  if (/"sources"\s*:/.test(source)) {
    throw new BundleVerificationError("Bundle contains forbidden embedded content: source map data")
  }
  if (/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main(?:\/|$)/i.test(source)) {
    throw new BundleVerificationError("Bundle contains a mutable raw GitHub branch URL")
  }
  if (/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/main(?:\/|$)/i.test(source)) {
    throw new BundleVerificationError("Bundle contains a mutable GitHub branch URL")
  }
}

async function verifyDefaultExport(filePath: string): Promise<void> {
  const namespace: object = await import(pathToFileURL(filePath).href)
  const value = Reflect.get(namespace, "default")
  if (typeof value !== "object" || value === null) {
    throw new BundleVerificationError("Bundle default export must be an instantiated object")
  }

  const missingMethod = REQUIRED_METHODS.find(
    (method) => typeof Reflect.get(value, method) !== "function",
  )
  if (missingMethod !== undefined) {
    throw new BundleVerificationError(
      `Bundle default export method is not callable: ${missingMethod}`,
    )
  }
}

export async function verifyBundleArtifact(filePath: string): Promise<void> {
  if (!(await Bun.file(filePath).exists()) || !statSync(filePath).isFile()) {
    throw new MissingBundleArtifactError(filePath)
  }

  const source = await Bun.file(filePath).text()
  verifyModuleStructure(source)
  verifyForbiddenContent(source)
  await verifyDefaultExport(filePath)
}

if (import.meta.main) {
  const [bundlePath] = Bun.argv.slice(2)

  await verifyBundleArtifact(bundlePath ?? join(process.cwd(), "dist", "aniliberty.mjs"))
}
