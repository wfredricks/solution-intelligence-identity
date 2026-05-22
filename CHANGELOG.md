# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `tsconfig.eslint.json` pins `compilerOptions.rootDir: "."`, overriding the extended `tsconfig.json`'s `rootDir: "./src"`. Without this, every file under `tests/**/*` reported `TS6059: ... is not under 'rootDir'`. `npx tsc --noEmit -p tsconfig.eslint.json` now exits 0. Phase 1a F4.
- `src/auth/__tests__/token.test.ts` adds an `if (!result.valid) throw` narrowing guard on `VerifyResult` so the test type-checks cleanly under the fixed tsconfig. Runtime behavior unchanged (the test already passed under `npm test`). Surfaced by F4 (pre-existing latent type error that was hidden by the TS6059 short-circuit).

### Tests

- `npm test`: 81/81 (unchanged).
- `npm run lint`: clean.

## [0.2.2-pre] — 2026-05-21

Stage 2d deliverable. SI/I adopts the `events-spine` archetype.

### Added

- **events-spine publisher derived into `src/events/`** with provenance
  JSDoc headers citing the source archetype (`archetypes/events-spine`,
  commit `1b334ab`, tag `events-spine-v0.1.0-pre`). Adoption is
  configuration-only — the reference-impl files are copied verbatim
  and the adopter-owned namespacing happens in
  `src/events/si-publisher.ts`. See `ARCHETYPE.md` for the adoption
  record.
- **`src/events/si-publisher.ts`** — typed wrapper exposing
  `publishLoginCompleted`, `publishGrantRecorded`,
  `publishRevokeRecorded` for the SI/I event surface. Subject prefix
  `si.identity` (adopter-owned). Publisher id
  `solution-intelligence-identity`. Graceful no-op semantics so a
  NATS outage does NOT fail user-facing operations.
- **Event emission wired** into the three state-changing flows:
  - `si.identity.login.completed` — emitted by `verify-code` after
    a token is issued. Payload `{ email, projectId }`. No token or
    code in the payload (events-spine C5).
  - `si.identity.grant.recorded` — emitted by `POST /grants` after
    the audit ledger and grant store both succeed. Payload
    `{ actor, projectId, targetUserId, role, auditBlockSeq }`.
  - `si.identity.revoke.recorded` — emitted by
    `POST /grants/:id/revoke` symmetric to grant.
- **Server boot** initializes the publisher; graceful shutdown
  drains it.
- **Integration test** (`tests/integration/events-emit.test.ts`)
  boots a real `nats-server`, the SI/I server, and a NATS
  subscriber. Verifies each event fires with the expected subject +
  payload AND asserts no token/code/password appears in any
  payload (events-spine C5 enforcement).
- **Unit tests** (`tests/events/si-publisher.test.ts`) — 8 tests
  covering subject names, payload shapes, C5 enforcement, and
  graceful no-op behavior under both connect-failure and
  publish-failure paths.
- **Dependencies**: `nats@^2.28.0`, `uuid@^11.0.0`, `@types/uuid`.

### Changed

- **`VERSION` bumped** from `0.2.0-pre` to `0.2.2-pre` (Stage 2d).
  Note: `0.2.1-pre` was reserved for the `X-SI-Actor`-retirement
  Stage 2b polish work and is folded forward.

## [0.2.0-pre] — 2026-05-20

Stage 2a deliverable. Per `build-history/BUILD-PLAN.md` and MODEL.md §6.

### Added

- **SI/I identity service** — boots a Hono HTTP server composing the bangauth
  archetype with SI-specific role-grant logic.
- **Bangauth archetype integration** — passwordless email-and-code
  authentication with monthly-rotating HMAC-SHA256 tokens. Sourced from
  `wfredricks/bangauth@3ae5106` and brought into the SI codebase via the
  archetype methodology (whole-cloth copy + documented modification +
  provenance tagging). See `ARCHETYPE.md`.
- **Role-grant ledger** — append-only JSONL at
  `<project>/data/identity/grants.jsonl`. Append + revoke operations are
  per-grant and never mutate prior rows.
- **`POST /resolve`** — token → `{ userId, displayName, effectiveRoles[] }`
  for use by SI/S and SI/W. Accepts the token as `Authorization: Bearer ...`
  or `{ token }` in the JSON body.
- **`POST /grants` and `POST /grants/:grantId/revoke`** — Owner-gated via
  `X-SI-Actor` header (v0.1 stop-gap; full token-based Owner gating arrives in
  Stage 2b CLI work). Emit `si.role.granted` and `si.role.revoked` audit
  events.
- **`GET /grants`** — admin / debug listing of ledger rows, optional
  `?projectId=` filter.
- **`GET /health`** — service health endpoint reporting name + version.
- **Audit emission wrapper** — produces canonical chainblocks payloads per
  MODEL.md §3.2. v0.1 writes a JSONL fallback at
  `<project>/data/chainblocks/si.audit.jsonl`; real chainblocks integration
  lands in Stage 2c.
- **`bin: si-identity`** — `node dist/server.js` is the CLI entry; `npm start`
  also works.

### Changed

- Bumped to **0.2.0-pre**.
- `src/index.ts` now re-exports the SI/I public API (`VERSION`,
  `startServer`, `buildApp`, `Role`, `RoleGrant`, `ResolveResponse`, `ROLES`,
  `ServerHandle`) instead of the Stage 1b VERSION-only scaffold.
- `tsup.config.ts` now builds two entries: `src/index.ts` and `src/server.ts`.
- `tsconfig.json` and `.eslintrc.json` exclude `src/auth/_deferred/**` from
  compile and lint (those files are kept for archetype completeness but not
  wired in v0.1).

### Architectural notes

- **Archetype, not dependency.** Bangauth's source is integrated into SI/I's
  `src/auth/` directory rather than imported as a package. See `ARCHETYPE.md`
  for refresh policy and maintenance ownership. This reduces SI's third-party
  dependency surface for ATO purposes.
- **MFA, recovery, browser-flow login, SES email, and SSM config deferred to
  v0.2.** Source files are kept under `src/auth/_deferred/` for archetype
  completeness; not wired into v0.1's routes and excluded from compile so
  their AWS-SDK imports don't drag into v0.1's runtime.
- **Token payload semantic rename.** `TokenPayload.constellationId` →
  `TokenPayload.projectId`; the bangauth crypto is otherwise byte-identical.
- **NATS publisher dropped from server wiring.** SI uses chainblocks for
  audit events; the bangauth NATS adapter file is intentionally not copied.

## [0.1.0-pre] — 2026-05-20

Stage 1b scaffold. No functional code; the real SI/I identity layer arrived
in Stage 2a (this release).

### Added

- Repository scaffolding: governance docs, build toolchain (TypeScript,
  tsup, vitest, eslint, prettier), CI workflow on Node 20.x + 22.x.
- `VERSION` export from `src/index.ts` so the toolchain has a real symbol
  to assert against.
- Smoke test that pins `VERSION === '0.1.0-pre'`.

[Unreleased]: https://github.com/wfredricks/solution-intelligence-identity/compare/v0.2.0-pre...HEAD
[0.2.0-pre]: https://github.com/wfredricks/solution-intelligence-identity/compare/v0.1.0-pre...v0.2.0-pre
[0.1.0-pre]: https://github.com/wfredricks/solution-intelligence-identity/releases/tag/v0.1.0-pre
