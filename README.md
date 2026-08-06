# AniLiberty torrent source for Hayase

This project is an unofficial Hayase torrent source for Russian-dub releases found through AniLiberty. It isn't
affiliated with, endorsed by, or maintained by AniLiberty or Hayase. The project uses its
own [original neutral icon](assets/aniliberty-neutral.svg), stored at
`assets/aniliberty-neutral.svg`.

## Status and scope

The extension is torrent-only and focused on Russian-dub media. It performs conservative, title-based matching with
declared `medium` accuracy. Matching uses normalized titles, season markers, media type, year, episode count, and
episode ranges when those fields are available. AniLiberty doesn't provide an AniList ID mapping through the consumed
API, so users should review the title, size, and torrent metadata before downloading.

This project has no HLS playback, streaming proxy, scraper, account or authentication flow, UI, fallback provider,
telemetry, remote logging, or background analytics. It doesn't modify Hayase or provide content itself.

## Installation

Releases publish a generated manifest named `index.json` to GitHub Pages. Its stable URL has this shape:

`https://<owner>.github.io/<repository>/index.json`

Use the owner and repository shown by the repository that published the release. This local source tree has no
configured public owner, so it can't provide a live install URL. Release generation derives the coordinates from
`GITHUB_REPOSITORY`, not from a branch or a hard-coded example.

In Hayase:

1. Copy the stable generated manifest URL ending in `/index.json` from the release repository.
2. Open **Settings**, then **Extensions**, then **Repositories**.
3. Paste the full manifest URL into the repository URL field.
4. Select **Import Extensions** and wait for Hayase to validate and download it.
5. Open **Extensions** and enable AniLiberty if it isn't already enabled.

The manifest is the supported import target. Don't paste a source file, a branch URL, or arbitrary JavaScript into
Hayase. Hayase reads the manifest and selects the immutable
`vMAJOR.MINOR.PATCH/aniliberty.mjs` code URL and its SHA-256 checksum.

## Updates and trust

Hayase checks the stable manifest for later versions when it starts. The update channel can change which immutable code
version Hayase loads, so treat repository ownership and release publication as part of the trust boundary. Verify that a
release's manifest digest, checksum file, provenance, and GitHub attestation refer to the same bundle before importing or
updating it.

## Behavior

Hayase calls the extension in three search modes:

* `single` requires a parsed episode range that covers the requested episode. A multi-episode pack is returned with type
  `batch` even when it satisfied a single-episode request.
* `batch` accepts a parsed season pack starting at episode 1 and covering more than one episode.
* `movie` accepts only an AniList movie query matched to an AniLiberty movie release.

Batch torrents can contain and download or store episodes beyond the requested episode. The exact download selection and
storage behavior belongs to the user's torrent client. Users control their client, storage, bandwidth, and legal
decisions.

Resolution filtering recognizes `2160`, `1080`, `720`, `540`, and `480`. A requested resolution is accepted only when
AniLiberty's quality and label each identify the same single resolution. A blank resolution accepts any otherwise valid
result. Hayase exclusions are applied case-insensitively to the torrent label, codec value and label, source/type, codec
color label, and quality. This is how unsupported codecs such as HEVC can be excluded.

The matcher checks up to three distinct normalized Latin-script titles, recognized season suffixes, year, media type,
episode count, block flags, and requested range. Equal top candidates are rejected. A missing match, an ambiguous match,
blocked media, unproven episode coverage, or complete filtering returns the ordinary no-match result `[]`. Availability
isn't guaranteed.

## Privacy and security

The extension connects only to the AniLiberty API origin `https://aniliberty.top` through these v1 endpoints:

* `https://aniliberty.top/api/v1/app/status` checks service health.
* `https://aniliberty.top/api/v1/app/search/releases?query=` receives up to three selected, normalized title candidates
  as the `query` value.
* `https://aniliberty.top/api/v1/anime/torrents/release/{releaseId}` receives the numeric AniLiberty release ID selected
  from search metadata.

AniLiberty and network intermediaries can observe normal request metadata, including IP address and the title query or
release identifier sent to those endpoints. Search requests use the fetch function injected by Hayase so its CORS and
network policy remains in control. The health check uses the worker's global fetch because Hayase's `test()` contract
doesn't provide an injected fetch.

The extension has no telemetry, analytics, response-body logging, query logging, or persistent query cache. Successful
unfiltered discovery records live only in worker memory for 60 seconds, with at most 64 entries. Failed requests aren't
retained.

Installing any extension means trusting its manifest, code URL, publisher, and update channel. Review the release
checksum and provenance before import. A checksum detects changed bytes but doesn't prove that code is safe. Hayase runs
extensions in a worker sandbox, but an extension still sees search data and can make permitted network requests.

BitTorrent operates independently after discovery. Torrent peers and trackers can observe the user's IP address as part
of normal peer communication. This extension can't provide anonymity or prevent third-party observation. Report security
issues through [SECURITY.md](SECURITY.md).

## Troubleshooting

Hayase receives the sanitized message `AniLiberty is unavailable` for infrastructure and parsing failures. It doesn't
receive private titles, response bodies, URLs containing queries, or internal causes. Maintainers can use these typed
categories when reproducing with safe fixtures:

| Category                           | Meaning                                                     | Action                                                                            |
|------------------------------------|-------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `transport`                        | AniLiberty couldn't be reached                              | Check connectivity and AniLiberty availability, then retry later.                 |
| `timeout` or `aborted`             | The request exceeded its deadline or was cancelled          | Retry once the network is stable. Don't increase timeouts without contract tests. |
| `transient-exhausted`              | A retryable 429, 502, 503, or 504 failed twice              | Wait for the upstream service or rate limit to recover.                           |
| `http`                             | AniLiberty returned a permanent non-success status          | Check the endpoint status and the scheduled drift workflow.                       |
| `api-validation`                   | AniLiberty rejected request metadata with 422               | Reproduce with reduced synthetic input and inspect contract compatibility.        |
| `content-type` or `malformed-json` | The response wasn't usable JSON                             | Treat HTML blocks separately from API schema changes.                             |
| `contract`                         | A successful JSON response didn't match the consumed schema | Inspect drift evidence before changing fixtures or parsers.                       |

An empty result isn't an error. Check title and season metadata, requested resolution, codec exclusions, media type, and
episode range. Conservative rejection is expected and doesn't imply that the matching has high precision for every
title.

## Development

Use Bun 1.3.14. These local checks don't contact live services:

```sh local
bun install --frozen-lockfile
bun run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for test and scope rules, and
[docs/maintenance.md](docs/maintenance.md) for contract and release operations.

## Legal boundaries

Users are responsible for choosing sources and content they have the right to access, and for following the laws and
service terms that apply in their jurisdiction. Torrent and media rules vary by location. Nothing in this repository is
legal advice, and using the software doesn't guarantee that any content use is lawful or safe.

The project code is available under the [MIT License](LICENSE). That license covers this project's code only. It doesn't
grant rights to third-party content, AniLiberty or Hayase names, logos, trademarks, services, or data. The project
remains unofficial.

Release history is summarized in [CHANGELOG.md](CHANGELOG.md).
