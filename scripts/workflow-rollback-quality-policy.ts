import { z } from "zod"

import { parseUniqueJson } from "./strict-json.ts"

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) })

const EXPECTED_SCRIPTS = {
  lint: "biome check .",
  typecheck: "bun run scripts/check-no-excuses.ts",
  "check:size": "bun run scripts/check-size.ts",
  "check:workflows":
    "bun run scripts/validate-workflows.ts .github/workflows/ci.yml .github/workflows/contract-drift.yml .github/workflows/release.yml",
  "contract:hayase": "bun run scripts/check-hayase-contract.ts",
  "contract:aniliberty": "bun run scripts/check-aniliberty-contract.ts",
  "check:contracts":
    "bun run contract:hayase -- --fixture tests/fixtures/hayase/types-56151c7.d.ts && bun run contract:aniliberty -- --fixture tests/fixtures/aniliberty/openapi-consumed.json",
  "check:rollback":
    "bun run lint && bun run typecheck && bun run check:size && bun run check:workflows && bun run check:contracts && bun test tests/release/rollback.test.ts tests/release/workflow-cli.test.ts tests/release/workflow-policy.test.ts tests/release/history-review.test.ts tests/release/integrity-review.test.ts",
} as const

export function validateRollbackQualityScripts(source: string): boolean {
  try {
    const parsed = packageSchema.safeParse(parseUniqueJson(source))
    if (!parsed.success) return false
    return Object.entries(EXPECTED_SCRIPTS).every(
      ([name, command]) => parsed.data.scripts[name] === command,
    )
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}
