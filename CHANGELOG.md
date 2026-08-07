# Changelog

All notable changes will be recorded here.

## Unreleased

## 0.1.1 - 2026-08-07

### Fixed

* Match AniLiberty candidates locally against trusted alternate AniList titles while keeping outbound search titles
  unchanged.

## 0.1.0 - 2026-08-06

### Added

* A manifest-v2 Hayase torrent source for AniLiberty Russian-dub releases.
* Conservative normalized title, season, year, media type, episode count, and range matching with ambiguity rejection.
* Single, batch, and movie result modes with resolution and codec/source exclusion filtering.
* A typed AniLiberty v1 client with bounded timeouts, one transient retry, injected search fetches, and sanitized user
  errors.
* A 60-second, 64-entry in-memory discovery cache that doesn't retain failures.
* A deterministic browser ESM bundle, original neutral icon, stable generated manifest, immutable version paths, SHA-256
  checksums, and provenance.
* Read-only quality CI, scheduled/manual contract drift classification, and globally serialized atomic GitHub Pages and
  GitHub Release publication.
* User, security, contribution, legal, and maintainer documentation.
