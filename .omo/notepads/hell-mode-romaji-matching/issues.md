# Issues

## 2026-08-07T21:21:19+03:00 - Todo 1
- The first widened run found the existing season-two discovery case overrode `titles` but inherited season-one `matchingTitles`; adding the matching override restored the test's intended season-two request. No production behavior change was needed.
- `lsp_diagnostics` intermittently timed out only for the newly added regression file; IDE inspections and Biome reported no problems, and strict typecheck passed.

## 2026-08-07T21:36:41+03:00 - Todo 3
- Concurrent Todo 2 and Todo 4 edits appeared in discovery and documentation paths during verification; they were left untouched and will remain unstaged.
- The final IDE inspection returned no problems but reported a timeout flag; an earlier 60-second IDE inspection, LSP diagnostics, Biome, and strict typecheck were clean.

## 2026-08-07T21:36:52+03:00 - Todo 4
- Concurrent Todo 3 work appeared as an untracked E2E test during verification. It was left untouched and excluded from staging.

## 2026-08-07T21:35:55+03:00 - Todo 2
- The initial alias fixture reused the season-two torrent, whose existing filter behavior correctly returned `[]`; returning the known eligible torrent isolates cache winner selection while release IDs still prove the independently selected winner.
- `lsp_diagnostics` again timed out after the edit; prior diagnostics were clean and the focused Bun suite, Biome, and strict typecheck passed.

## 2026-08-07T22:00:14+03:00 - Todo 5
- The protected untracked `.log/` directory remains the only inherited worktree entry and is excluded from all inspection, cleanup, and staging operations.
- Hosted Quality succeeded with a non-blocking GitHub annotation that pinned checkout/setup-bun actions target deprecated Node.js 20 and are currently forced onto Node.js 24; repository gates themselves passed.

## 2026-08-07T22:20:56+03:00 - Todo 6
- The same non-blocking Node.js 20 deprecation/forced Node.js 24 annotation appeared on the successful Release run; it did not affect build, attest, release, deploy, or public artifact verification.
- The protected untracked `.log/hayase-logs.ansi` remained the sole worktree entry and was never opened, modified, staged, or removed.

## 2026-08-08T12:15:45+03:00 - Todo 7
- The protected log contains private unrelated activity and historical CORS records; only metadata classes/timestamps were retained, and the AniLiberty root category remained invisible because the adapter sanitizes it.
- Playwright MCP expected an unavailable Chrome distribution, so the reproduction used isolated Playwright-core with system Chromium and removed that temporary workspace afterward.
- The new browser compatibility test is intentionally red until the separate production-fix task; full-suite green is therefore not claimed in this diagnosis-only task.

## 2026-08-08T12:45:12+03:00 - Todo 8
- The first full-check invocation stopped at Biome on one newly added function signature before later gates ran; applying the exact canonical formatting yielded the complete green full check.
- LSP fresh diagnostics intermittently timed out for the two test files; focused Biome, IDE inspections/lint, strict no-excuse typecheck, IDE rebuild, focused tests, and the full suite were clean.
- The protected untracked `.log/` remained off-limits and excluded from staging.

## 2026-08-08T13:20:15+03:00 - Todo 9
- Initial hosted Quality `31252012819` hit Bun's default five-second browser setup timeout; after bounded headroom, first Release dry-run `31252261319` reproduced variable standalone `/usr/bin/chromium` startup and killed an unrelated contract subprocess during timeout cleanup.
- The runner image's verified `CHROME_BIN` path fixed the portability defect without changing workflows, production behavior, browser assertions, or skip conditions; final hosted Quality and dry-run succeeded.
- Fresh LSP diagnostics intermittently timed out after the final test edit; IDE problems, Biome, strict typecheck, focused tests, and both hosted full gates were clean.

## 2026-08-08T13:58:00+03:00 - Todo 10
- The first Playwright CDP instance retained a pending navigation after a direct `page.goto`, causing local locator timeouts. A fresh CDP connection drove the real first-run UI normally; publication state and the isolated profile remained safe.
- The first temporary public-artifact harness returned its Worker promise without awaiting it before `await using` disposal. Changing only the temporary driver to await the call made both deterministic S2 runs pass; no repository or public bytes changed.
- The installed app's fresh-profile startup emits unrelated empty-DoH and update diagnostics; neither affected extension import, Worker health, enabled state, or public artifact verification.

## 2026-08-08T15:20:00+03:00 - Todo 11
- The prior synthetic S2 fixture used `Hell Mode 2nd Season`, which did not represent current candidate 10239's real English romanization and therefore hid the compound-boundary failure.
- Actual Hayase exclusions are empty, so a repaired match yields both AVC and HEVC; the required one-AVC control must hold HEVC excluded explicitly and must not be misreported as the actual user query.
- Fresh LSP diagnostics timed out twice after the test edit; Biome, repository typecheck, IDE inspections, and IDE build were clean. A direct file argument to the repository typecheck script is unsupported and produced configuration-noise errors; the proper no-argument command passed.

## 2026-08-08T15:45:18+03:00 - Todo 12
- No diagnostic fallback was needed: LSP and IDE inspections were clean for both permanent changed TypeScript files.
- The protected untracked `.log/` remained untouched and excluded from inspection, cleanup, and staging.
- The exact fixed-response runtime QA used a temporary E2E file only for execution and deleted it immediately after the green run.
