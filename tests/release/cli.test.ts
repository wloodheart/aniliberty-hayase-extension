import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workspaces: string[] = []
const buildScript = join(import.meta.dir, "../../scripts/build-release.ts")

type CliResult = {
  readonly exitCode: number
  readonly stderr: string
}

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "aniliberty-release-cli-"))
  workspaces.push(workspace)
  mkdirSync(join(workspace, "src"))
  writeFileSync(join(workspace, "src", "index.ts"), "export default Object.freeze({})\n")
  return workspace
}

async function runCli(workspace: string, args: readonly string[]): Promise<CliResult> {
  const process = Bun.spawn(["bun", "run", buildScript, ...args], {
    cwd: workspace,
    stderr: "pipe",
    stdout: "ignore",
  })

  return {
    exitCode: await process.exited,
    stderr: await new Response(process.stderr).text(),
  }
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { force: true, recursive: true })
  }
})

describe("release CLI parsing", () => {
  test.each([
    {
      args: ["--version", "1.2.3", "--version", "2.0.0", "--repository", "example/aniliberty"],
    },
    {
      args: [
        "--version",
        "1.2.3",
        "--repository",
        "example/aniliberty",
        "--repository",
        "other/aniliberty",
      ],
    },
  ])("rejects duplicate release coordinates before output mutation", async ({ args }) => {
    // Given: an isolated workspace and duplicated CLI coordinates
    const workspace = createWorkspace()

    // When: the real release CLI parses the arguments
    const result = await runCli(workspace, args)

    // Then: it fails without publishing output
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("Duplicate release argument")
    expect(existsSync(join(workspace, ".release-site"))).toBeFalse()
  })
})
