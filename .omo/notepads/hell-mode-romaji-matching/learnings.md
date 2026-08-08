# Learnings

## 2026-08-07T21:21:19+03:00 - Todo 1
- There is one production `DiscoveryRequest` constructor, in `src/hayase/adapter.ts`; direct tests derive requests from `baseDiscoveryRequest`.
- `selectSearchTitles()` already provides deterministic trim, normalized deduplication, Latin filtering, and the three-title cap at the local matcher boundary, so raw trusted alias ordering can remain query titles then AniList userPreferred, English, and romaji.
- The adapter regression was genuinely red before production edits with expected one AVC result and actual `[]`, then green after the title-flow split.

## 2026-08-07T21:36:41+03:00 - Todo 3
- `createReleaseWorkspace()` is the generated-artifact boundary needed by Worker E2E: it builds and verifies the bundle, creates release metadata, and lets `HayaseWorkerHarness` checksum and import the published artifact rather than source modules.
- Capturing requests in `withAniLibertyServer()` observes the bridged production path and decoded `query` exactly while keeping every Worker fetch on an ephemeral localhost server.
- A fresh harness per alias scenario makes the unrelated-romaji result independent of Worker memory while preserving the exact Todo 1 Hayase/media title split.

## 2026-08-07T21:36:52+03:00 - Todo 4
- The README now separates transient local AniList aliases from the selected `query.titles` sent to AniLiberty.
- The existing claim fixtures covered unsafe accuracy wording but didn't directly reject positive AniList ID mapping or outbound alias claims.

## 2026-08-07T21:35:55+03:00 - Todo 2
- Alias-cache coverage is isolated with two synthetic candidates that differ only in their local matching aliases; the test observes the same outbound title twice, distinct release IDs, and two loads.
- A `Promise.withResolvers` search barrier proves two value-identical requests produce one in-flight load, and a third request leaves both search and torrent counts at one.

## 2026-08-07T22:00:14+03:00 - Todo 5
- Tracked version-literal search found the release-owned current version only in `package.json` and the prior release heading in `CHANGELOG.md`; `bun.lock` has no root workspace version field.
- The manual Release workflow dry-run executes only the read-only `build` job; `attest`, `release`, and `deploy` are tag-push-only, while rollback jobs are operation-specific.
- Hosted Quality run `31209270592` and Release dry-run `31209372289` both completed successfully for exact pushed SHA `73adb3bf3cddf2a935555f1488f790dfe53d9692`.

## 2026-08-07T22:20:56+03:00 - Todo 6
- The single annotated tag object is `04517aee45ca294b5e793afc9c15db13b33a94c4` and peels to approved commit `73adb3bf3cddf2a935555f1488f790dfe53d9692`.
- Tag-triggered Release run `31210616697` completed build, attestation, GitHub Release, and Pages deploy successfully; public v0.1.1 bytes match the dry-run digest `201e1eb74efee277061364d8c456b88aab32592b0c9f76970910c9955cf3c0fc` across every integrity source.
- Replacing only the generated harness artifact with the downloaded Pages bundle provides a deterministic real-public-artifact test surface for both default `test()` and the exact Hell Mode Worker scenario.

## 2026-08-08T12:15:45+03:00 - Todo 7
- Real Chromium proved the v0.1.1 failure occurs before the health request reaches the network: storing native Worker `fetch` and invoking it as `spec.fetch(...)` supplies an illegal Web IDL receiver.
- Binding only Worker fetch to `globalThis` toggles the exact public bundle from sanitized unavailable to `true`; reverting restores failure, while CORS header variants do not change the unbound result.
- A permanent real-browser failing-first test now covers generated artifact -> Blob Worker import -> zero-argument `test()` -> five-second Hayase guard with a valid CORS-enabled health fixture.

## 2026-08-08T12:45:12+03:00 - Todo 8
- Binding both fetch functions once in `AniLibertyClient` fixes health and discovery without changing `InternalAniLibertyClient` request semantics.
- Receiver-sensitive unit tests must observe parsed values and endpoint/query data; call counts alone would not prove the request remained correct.
- The real Chromium generated-artifact control distinguishes valid health (`true`, one request) from malformed health (sanitized unavailable, one request), proving both receiver repair and schema enforcement.

## 2026-08-08T13:20:15+03:00 - Todo 9
- The Ubuntu 24 hosted image exports `CHROME_BIN=/usr/bin/google-chrome`; using that verified image path avoids variable standalone Chromium startup while preserving a local `/usr/bin/chromium` fallback and the full native Worker regression.
- Final Quality run `31252437359` and Release dry-run `31252464054` both passed for exact pushed SHA `890b5aed7b3d8732814266f2178062f6a9b3c0b3` and explicitly executed both browser compatibility cases.
- Local and hosted v0.1.2 dry-run payloads are deterministic at `0ea9d7bdf57a5a2bb792c3035d475856ae567b8ab837a7225337722ffdcc336d`; public v0.1.1 remains `201e1eb74efee277061364d8c456b88aab32592b0c9f76970910c9955cf3c0fc`.

## 2026-08-08T13:58:00+03:00 - Todo 10
- Tag-triggered Release run `31253282105` published and deployed the exact dry-run bytes; attestation `39577861`, Release asset metadata, Pages, checksum, and provenance all agree on `0ea9d7bdf57a5a2bb792c3035d475856ae567b8ab837a7225337722ffdcc336d`.
- Installed Hayase can be safely exercised with explicit temporary user-data and cache directories plus CDP; importing the public manifest displayed the checked AniLiberty 0.1.2 card and completed the real Worker health path without the unavailable toast.
- Replacing only a temporary harness artifact with freshly downloaded public bytes gives deterministic native Chromium health and exact S2 matching/privacy evidence without sending a title live.

## 2026-08-08T15:20:00+03:00 - Todo 11
- The real Hayase query has nine titles, not one; the first three outbound-selected forms are romaji variants, while the displayed English title is fifth. All AniList title fields are present, episode/count are 3/13, resolution is 1080, and exclusions are empty.
- Live searches validate three candidates each, but candidate 10239 receives no title score because Hayase `Haisettei` and AniLiberty `Hai Settei` fall below token containment despite identical season/year/type eligibility.
- A fixed-response candidate-title toggle proves the mechanism: split compound gives no torrent request; joined compound fetches two actual eligible torrents, or exactly one AVC when HEVC is held excluded; restoring split returns no result.

## 2026-08-08T15:45:18+03:00 - Todo 12
- Equal compacted season-base text is safe as an 80-point boundary signal only with equal effective seasons and at least four unchanged significant tokens; this accepts long romanized context while rejecting `Superman`/`Super Man` and `AB`/`A B`.
- The generated installed-style Worker replay now returns two eligible fixed results for episode 3 with empty exclusions and exactly one AVC result when HEVC is explicitly excluded.
- The score branch composes before unchanged 0.9 containment, so exact 100, season-equivalent 90, and broad containment behavior remain independently covered.

## 2026-08-08T15:58:17+03:00 - Todo 13
- The v0.1.3 local release artifact is deterministic at `48aee26de9436f081a3238b6b7a3a74df94a06b1a67c91f653299cf32e6ba6ee` across the bundle, manifest, checksum, and provenance.
- Serialized focused gates passed with 37 matcher/integration tests, 10 generated Worker tests, and two real-Chromium compatibility tests before the single complete repository check.
- Public v0.1.2 remained `0ea9d7bdf57a5a2bb792c3035d475856ae567b8ab837a7225337722ffdcc336d` before the hosted approval phase.
