# Contributing

## Development contract

Use Bun 1.3.14 and install the exact lockfile. Keep changes inside the torrent-only, Russian-dub-focused Hayase source
described in [README.md](README.md#status-and-scope). Contributions must not add HLS, a proxy, scraping, authentication,
UI, another provider, telemetry, remote logging, or persisted searches.

Follow red, green, refactor TDD. Write the failing behavior test first and confirm its failure, then add the smallest
implementation. Unit tests cover pure boundaries, integration tests use local
`Bun.serve` endpoints, and end-to-end tests exercise generated artifacts. Ordinary tests and
`bun run check` must not contact live AniLiberty, Hayase, or other services. Live checks belong only in the scheduled or
manually dispatched contract-drift workflow.

```sh local
bun install --frozen-lockfile
bun run check
```

Strict TypeScript, Biome, workflow policy, contract pins, bundle verification, and deterministic tests are required.
Don't use `any`, type assertions, non-null assertions, ignored diagnostics, or mutable dependency ranges. Source files
must stay at or below 250 pure lines. Treat the 200 to 250 band as a warning and split before adding another
responsibility. The no-excuse and size gates are part of `bun run check`.

Use Conventional Commits with a focused scope, such as `fix(api): classify response drift`. Keep an implementation and
its tests in the same commit. Don't commit `dist/`, `.release-site/`,
`release-payload/`, coverage, `node_modules/`, `.omo/`, `.idea/`, local evidence, secrets, or editor state. Remove
generated artifacts and temporary fixtures before requesting review.

## Contract and fixture changes

Never auto-accept upstream drift. Fetch and inspect upstream contracts, reduce them to fields the extension consumes,
update fixtures intentionally, and prove compatibility and breaking cases. See
the [maintenance runbook](docs/maintenance.md#fixture-refresh).

## Pull requests

Explain the user-visible behavior, the red test, the green verification, contract or privacy impact, and any generated
artifacts used only during local testing. Keep private title queries and upstream response bodies out of issues,
commits, fixtures, logs, and screenshots.

By contributing, you agree that your contribution is licensed under the repository's
[MIT License](LICENSE).
