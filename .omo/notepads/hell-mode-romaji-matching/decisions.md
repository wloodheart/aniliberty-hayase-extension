# Decisions

## 2026-08-07T21:21:19+03:00 - Todo 1
- Kept the external `AnimeQuery` contract unchanged: `media` remains an untrusted `unknown`, while the existing Zod boundary retains only non-null userPreferred, English, and romaji aliases.
- Kept outbound discovery on `request.titles` and switched only `matchingQuery()` to required `request.matchingTitles`.
- Included both title arrays in cache identity without changing cache lifetime, capacity, coalescing, or failure eviction.

## 2026-08-07T21:36:41+03:00 - Todo 3
- Added a compact dedicated Worker E2E file and reused all existing release, server, bridge, Blob URL, and Worker cleanup contracts; no support or production file required modification.
- Built the synthetic S2 AVC response exactly as Todo 1 did by retaining the S2 torrent metadata and substituting the existing AVC hash, magnet, and codec fixture.
- Used separate positive and negative Worker scenarios so each test has one public `batch` action and the negative case proves ordinary `[]` settlement without stale in-Worker state.

## 2026-08-07T21:36:52+03:00 - Todo 4
- Kept the alternate-title fix under `Unreleased`; release-version conversion remains deferred to Todo 5.
- Added focused phrase rules for AniList ID mapping and outbound AniList aliases because the existing fixture contract lacked those two required rejection cases.

## 2026-08-07T21:35:55+03:00 - Todo 2
- Kept the new coverage in `tests/integration/discovery.test.ts` and did not alter production cache, discovery, matcher, or fixture files.
- Reused the existing matcher suite for hard conflicts and ambiguity; discovery assertions cover only alias-sensitive cache identity, exact outbound titles, and cache network counts.

## 2026-08-07T22:00:14+03:00 - Todo 5
- Changed only `package.json` and `CHANGELOG.md` as release-owned tracked metadata; no lockfile regeneration is required.
- Kept a fresh empty `Unreleased` section above the exact `0.1.1 - 2026-08-07` heading and moved the existing fix text unchanged beneath it.
- Pushed the six reviewed atomic commits normally to `main` and dispatched only the permitted hosted `operation=dry-run`, `version=0.1.1`; no tag, Release, or Pages deployment was created.

## 2026-08-07T22:20:56+03:00 - Todo 6
- Created one annotated `v0.1.1` tag with annotation `Release v0.1.1` and pushed only `refs/tags/v0.1.1`; no branch, source commit, manual asset upload, or manual Pages deployment was performed.
- Treated workflow success as necessary but insufficient: completion required public Pages and Release downloads, checksum/provenance/attestation agreement, retained v0.1.0 byte equality, and deterministic public-bundle behavior.

## 2026-08-08T12:15:45+03:00 - Todo 7
- Rejected CORS, live schema/WAF drift, timeout, and stale cache only after controlled browser evidence; none is inferred from historical log text.
- Deferred all production edits and release work. The next fix must bind both health and discovery fetches at the client boundary, make the browser test green unchanged, and precede a separate 0.1.2 release task.
- Kept v0.1.1 immutable and left the failing-first browser test and exact test-only dependency uncommitted.

## 2026-08-08T12:45:12+03:00 - Todo 8
- Kept the production fix to two constructor-option expressions in `src/aniliberty/client.ts`; no internal request, timeout, retry, schema, sanitization, matching, cache, or filter code changed.
- Retained exact test-only `playwright-core` 1.62.1 and kept the primary browser assertion `{ kind: "result", value: true }` unchanged.
- Added a separate malformed-health browser control rather than weakening the happy-path fixture, so validation and one-request behavior remain independently observable.

## 2026-08-08T13:20:15+03:00 - Todo 9
- Changed release-owned metadata only in `package.json` and `CHANGELOG.md`; `bun.lock` remained unchanged and the release metadata commit is `79c237ad37b78bf55475b640eb2371bf098c5367`.
- Kept hosted portability fixes in separate test-only commits: bounded suite setup at 15 seconds and selected explicit override, hosted `CHROME_BIN`, then local Chromium. The Worker's five-second guard and both native browser assertions remain unchanged.
- Treated failed hosted runs as diagnostics, not approvals; only final exact-SHA Quality and Release dry-run completed-success JSON authorizes Todo 10. No v0.1.2 publication action was taken.

## 2026-08-08T13:58:00+03:00 - Todo 10
- Created annotated tag object `99718793a130b060e09ccc594cb84e229671c3d6` with `Release v0.1.2`, verified it peeled to the approved SHA, and pushed only the exact tag ref once.
- Treated workflow success as necessary but insufficient: completion required fresh public byte/checksum/provenance comparisons, attestation verification, predecessor immutability, native Worker controls, and installed-Hayase import/enable QA.
- Used the installed binary only with a new temporary profile/cache and deterministic health fixture; no real profile/log/storage was accessed and no title was sent live.

## 2026-08-08T15:20:00+03:00 - Todo 11
- Classified release matching as the first failed stage only after exact installed-Hayase reproduction, Worker query capture, live metadata-only probes, fixed-response replay, and a split/joined/split candidate-title toggle.
- Left production and v0.1.2 immutable. The sole code change is an intentionally red matcher regression using reduced synthetic metadata; a generic conservative normalization fix and immutable 0.1.3 release remain separate follow-up tasks.
- Preserved the broad 0.9 containment threshold and outbound privacy contract; any follow-up compact-boundary rule must first pass a negative collision test and must not add extra outbound aliases.

## 2026-08-08T15:45:18+03:00 - Todo 12
- Kept boundary equivalence local to `scoreTitleMatch()` instead of changing global normalization, search-title selection, aliases, cache identity, or outbound requests.
- Assigned boundary-only equivalence score 80 and required four unchanged significant tokens plus equal effective seasons; exact and season-equivalent scores retain precedence.
- Preserved equal-top ambiguity rather than using boundary evidence to choose between compact-equal candidates.

## 2026-08-08T15:58:17+03:00 - Todo 13
- Changed only release-owned package and changelog metadata; `bun.lock`, dependencies, source, tests, and workflows remain unchanged.
- Kept a fresh empty `Unreleased` section above exact heading `0.1.3 - 2026-08-08` and described only the conservative romanized word-boundary fix.
- The atomic release-preparation commit includes local evidence and append-only notepad records; hosted run identifiers will be appended after exact-SHA approval without altering the approved commit.
