# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.1.0-pre] — 2026-05-20

Stage 1b scaffold. No functional code; the real SI/I identity layer
(a `bangauth` wrapper enforcing SI's 5-role permission matrix per
REQ-SI-NF-031 and the role table in MODEL.md §3) arrives in Stage 6.

### Added

- Repository scaffolding: governance docs, build toolchain (TypeScript,
  tsup, vitest, eslint, prettier), CI workflow on Node 20.x + 22.x.
- `VERSION` export from `src/index.ts` so the toolchain has a real
  symbol to assert against.
- Smoke test that pins `VERSION === '0.1.0-pre'`.

[Unreleased]: https://github.com/wfredricks/solution-intelligence-identity/compare/v0.1.0-pre...HEAD
[0.1.0-pre]: https://github.com/wfredricks/solution-intelligence-identity/releases/tag/v0.1.0-pre
