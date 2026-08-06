# Maintenance runbook

## Support matrix

The supported toolchain and external boundaries are deliberately narrow:

| Component   | Supported contract                                                               | Maintenance rule                                                                                |
|-------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Bun         | Exactly 1.3.14                                                                   | Keep `package.json`, lockfile, CI, and release setup aligned.                                   |
| Hayase      | `hayase-app/interface` commit `56151c710a9265f42994bd72cff007598c596bab`         | Compare the consumed manifest, query, result, and source method shapes before changing the pin. |
| AniLiberty  | API v1 at `https://aniliberty.top/api/v1`                                        | Consume only status, release search, and release torrent list contracts.                        |
| Manifest    | Version 2                                                                        | Keep the permanent ID `aniliberty.torrents` and stable update URL.                              |
| Media       | Russian-dub torrents                                                             | Preserve `torrent`, `dub`, `RU`, and `medium` metadata.                                         |
| Unsupported | HLS, HTTP/WebSeed, NZB, subtitles, proxy, UI, auth, scraping, fallback providers | A request for these needs a separate design and isn't a compatibility fix.                      |

## Supported contracts

The local pins live in [contracts/hayase-extension-contract.json](../contracts/hayase-extension-contract.json)
and [contracts/aniliberty-v1.contract.json](../contracts/aniliberty-v1.contract.json). The release manifest is generated
from [src/release/model.ts](../src/release/model.ts), not edited by hand.

## Fixture refresh

Fixture refresh is review-first and never an automatic response to drift:

1. Fetch the relevant upstream Hayase declaration or AniLiberty OpenAPI document in the dedicated network drift job.
2. Inspect the structural diff and confirm the endpoint, media type, and consumed fields by hand.
3. Decide whether the change is compatible, breaking, transient, or an environmental block.
4. Update only the reduced contract and synthetic fixture fields that the extension consumes. Don't copy response
   bodies, descriptions, real magnets, user queries, or unrelated upstream fields.
5. Run the focused compatibility test and its breaking fixture. For Hayase, run
   `bun run contract:hayase -- --fixture tests/fixtures/hayase/types-56151c7.d.ts`. For AniLiberty, run
   `bun run contract:aniliberty -- --fixture tests/fixtures/aniliberty/openapi-consumed.json`.
6. Run `bun run check` and review the generated structural diff before committing.

Never auto-bless drift by replacing expected output with the newest upstream response. A green fixture that wasn't
reviewed can hide a breaking runtime change.

## Contract drift response

The weekly and manual [contract drift workflow](../.github/workflows/contract-drift.yml) uses stable outcome tokens:

| Token                     | Meaning                                                       | Maintainer action                                                                                       |
|---------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `PASS_API_OK`             | Health returned a valid API v1 status shape                   | No action. Keep the evidence only for the workflow run.                                                 |
| `SKIP_ENV_BLOCKED_403`    | The runner was blocked with 403                               | Don't change contracts. Retry from a permitted environment or wait for the next run.                    |
| `SKIP_ENV_NETWORK`        | DNS, transport, or timeout prevented a check                  | Check GitHub runner and upstream status, then rerun. Don't refresh fixtures.                            |
| `SKIP_ENV_TRANSIENT_HTTP` | A transient 408, 425, 429, 500, 502, 503, or 504 occurred     | Wait and rerun. Escalate only if repeated evidence shows a permanent change.                            |
| `FAIL_ENDPOINT_DRIFT`     | A non-transient status suggests the endpoint moved or changed | Inspect the uploaded evidence and upstream API documentation. Fix the endpoint only after confirmation. |
| `FAIL_SCHEMA_DRIFT`       | A 200 JSON response failed the consumed schema or media type  | Compare the reduced contract, classify compatibility, and follow the review-first fixture procedure.    |

Contract comparison failures upload `drift-evidence` for 14 days. Evidence should contain structural diagnostics and
tokens, not private title queries or response bodies.

## Release checklist

Prepare a semantic release only after the default branch is green:

1. Choose `MAJOR.MINOR.PATCH` from the user-visible compatibility change and update the `version` in
   [package.json](../package.json). Don't claim a version in [CHANGELOG.md](../CHANGELOG.md) until it has actually
   shipped.
2. Update the changelog's Unreleased entries, contract pins, and support matrix when needed.
3. Run the frozen install and full local gate.
4. Set `GITHUB_REPOSITORY` to the actual `owner/repository` metadata and run the isolated release dry run below.
   `RELEASE_VERSION` is read from `package.json`, so package and artifact versions agree.
5. Delete local `dist/`, `.release-site/`, `.release-site.backup`, `.release-site.lock`,
   `.release-site.stage-*`, and `release-payload/` outputs after inspection.
6. Manually dispatch the Release workflow on `main` with the same version. This validates coordinates, runs all gates,
   restores release history, and prepares artifacts without publishing.
7. Create and push one immutable `vMAJOR.MINOR.PATCH` tag that exactly matches the package version. Don't reuse or move
   a release tag.

```sh local
bun install --frozen-lockfile
bun run check
RELEASE_VERSION="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
bun run release:dry-run -- --version "$RELEASE_VERSION" --repository "$GITHUB_REPOSITORY"
```

All release workflow runs share the global `release` concurrency group with cancellation disabled. This serializes
different tags and manual dry-runs so one complete Pages history can't erase another.

## Atomic publication and provenance

The release workflow restores all prior immutable version directories from asset-bearing GitHub Releases, then builds a
complete Pages tree. Publication contains one stable `index.json` plus one directory per version. Each
`vMAJOR.MINOR.PATCH` directory contains only `aniliberty.mjs`,
`aniliberty.mjs.sha256`, and `provenance.json`.

The builder validates all coordinates before staging, holds an exclusive local publication lock, and swaps the complete
site tree. CI verifies the bundle digest against the manifest, checksum, and provenance. A GitHub build attestation is
created before an asset-bearing GitHub Release, and Pages activation happens only after that release succeeds. Existing
version directories and GitHub Releases fail closed rather than being overwritten.

The stable install URL is generated as `https://<owner>.github.io/<repository>/index.json` from
`GITHUB_REPOSITORY`. The manifest then selects the immutable
`https://<owner>.github.io/<repository>/vMAJOR.MINOR.PATCH/aniliberty.mjs` and exact checksum. Never publish a branch,
raw source, or moving bundle URL.

## Rollback

Rollback changes the stable pointer, not immutable history:

1. Stop new release publication and identify the last verified semantic version.
2. Download that version's `aniliberty.mjs`, `aniliberty.mjs.sha256`, and `provenance.json` from its retained GitHub
   Release. Verify the checksum and provenance repository, version, Hayase pin, and artifact path.
3. Restore the previous complete Pages tree from a retained deployment artifact, or reconstruct the complete tree from
   all retained GitHub Release assets. Keep every immutable version directory.
4. Restore the root `index.json` from the prior verified deployment. If reconstruction is required, repoint only its
   `version`, immutable `code` URL, and `sha256` to that verified prior version while preserving the stable `update` URL
   and the rest of the manifest contract.
5. Deploy that complete Pages tree through the protected GitHub Pages environment under the global
   `release` serialization group. Don't rerun generation for an existing version and don't overwrite any immutable asset
   or GitHub Release.
6. Fetch the stable manifest, confirm it selects the prior `vMAJOR.MINOR.PATCH/aniliberty.mjs`, verify the downloaded
   checksum, and retain GitHub Release assets, provenance, attestation, failed-run evidence, and the newer immutable
   version for audit.

If a local atomic swap fails before commit, the builder restores `.release-site.backup`. If backup restoration also
fails, preserve the reported backup path and recover it to `.release-site` before running another build. If publication
committed but backup cleanup failed, keep the active site and remove the stale backup only after verifying the active
tree.

## Routine verification

The [quality workflow](../.github/workflows/ci.yml) uses read-only repository permissions and runs a frozen install plus
`bun run check`. That aggregate gate validates formatting, strict types, deterministic tests, source size, workflow
policy, both offline contracts, the production bundle, and bundle import. Network checks remain isolated in the
scheduled/manual drift workflow.

Review [SECURITY.md](../SECURITY.md) before handling a vulnerability and
[CONTRIBUTING.md](../CONTRIBUTING.md) before accepting a fixture or contract change.
