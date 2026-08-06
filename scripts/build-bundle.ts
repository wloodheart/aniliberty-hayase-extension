import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

const BUNDLE_NAME = "aniliberty.mjs"

export class ProductionBuildError extends Error {
  readonly name = "ProductionBuildError"

  constructor(readonly diagnostics: readonly string[]) {
    super(`Production bundle generation failed: ${diagnostics.join(" | ")}`)
  }
}

export async function buildProductionBundle(workspace: string): Promise<void> {
  const outputDirectory = join(workspace, "dist")
  rmSync(outputDirectory, { force: true, recursive: true })
  const stagingDirectory = mkdtempSync(join(workspace, ".dist-stage-"))
  let published = false

  try {
    const build = await Bun.build({
      entrypoints: [join(workspace, "src", "index.ts")],
      format: "esm",
      minify: { identifiers: false, syntax: true, whitespace: true },
      naming: BUNDLE_NAME,
      outdir: stagingDirectory,
      packages: "bundle",
      root: workspace,
      sourcemap: "none",
      splitting: false,
      target: "browser",
      throw: false,
    })

    if (!build.success) {
      throw new ProductionBuildError(build.logs.map((log) => log.message))
    }

    mkdirSync(outputDirectory)
    renameSync(join(stagingDirectory, BUNDLE_NAME), join(outputDirectory, BUNDLE_NAME))
    published = true
  } finally {
    if (!published) rmSync(outputDirectory, { force: true, recursive: true })
    rmSync(stagingDirectory, { force: true, recursive: true })
  }
}

if (import.meta.main) {
  buildProductionBundle(process.cwd()).catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  })
}
