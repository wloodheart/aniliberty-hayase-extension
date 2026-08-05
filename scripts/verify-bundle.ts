import { statSync } from "node:fs"
import { join } from "node:path"

export class MissingBundleArtifactError extends Error {
  constructor(readonly filePath: string) {
    super(`Expected bundle artifact file at ${filePath}`)
    this.name = "MissingBundleArtifactError"
  }
}

export async function verifyBundleArtifact(filePath: string): Promise<void> {
  if (!(await Bun.file(filePath).exists()) || !statSync(filePath).isFile()) {
    throw new MissingBundleArtifactError(filePath)
  }
}

if (import.meta.main) {
  const [bundlePath] = Bun.argv.slice(2)

  if (bundlePath !== undefined) {
    await verifyBundleArtifact(bundlePath)
  } else {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/index.ts")],
      format: "esm",
      outdir: join(process.cwd(), "dist"),
      target: "browser",
    })

    if (!result.success) {
      for (const log of result.logs) {
        console.error(log.message)
      }

      process.exitCode = 1
    } else {
      await verifyBundleArtifact(join(process.cwd(), "dist", "index.js"))
    }
  }
}
