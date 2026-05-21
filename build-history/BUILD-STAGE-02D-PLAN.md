# BUILD-STAGE-02D-PLAN.md

*Stage 2d: SI/I adopts the events-spine archetype. First adoption to update an existing archetype's Hypothesis status nodes in the asi SIG (events-spine H6 + H7 flip from "untested" to held/partial/violated).*

*Written 2026-05-21 ~17:00 EDT by Bhai. To be executed by a single sub-agent run.*

---

## Required reading (in order, before starting)

0. **Query the SIG first.** Run `asi contracts show events-spine` (from `~/.openclaw/workspace/artifacts/archetypes-solution-intelligence/`) — your authoritative spec. The events-spine Contract subgraph (Principles, Constraints, Services, Processes, DataObjects, Hypotheses) is the load-bearing artifact this adoption must satisfy.
1. `~/.openclaw/workspace/artifacts/archetypes/events-spine/ADOPTION-RECIPE.md` — the events-spine adoption recipe sketch (from the events-spine build).
2. `~/.openclaw/workspace/artifacts/archetypes/events-spine/reference-impl/` — the source code you are deriving from.
3. `~/.openclaw/workspace/artifacts/archetypes/events-spine/LEFT-BOOKEND.md` — readable form of the contract. SIG (item 0) is authoritative; this is reference material.
4. `~/.openclaw/workspace/artifacts/archetypes/METHODOLOGY.md` — especially §Marking conventions, §Archetype-owned vs. adopter-owned, §SIG ↔ archetype tracing.
5. `~/.openclaw/workspace/artifacts/si-runtime/identity/` — the adopting project (existing repo, currently at v0.2.0-pre).
6. `~/.openclaw/workspace/artifacts/si-runtime/identity/build-history/BUILD-STAGE-02A-FINDINGS.md` — the prior Stage 2a precedent.
7. `~/.openclaw/workspace/artifacts/archetypes-bootstrap/BUILD-EVENTS-SPINE-FINDINGS.md` — the just-finished events-spine build's findings (writeback scripts, snapshot rendering, parser hardening hints).

## Scope

Three deliverables in `wfredricks/solution-intelligence-identity`:

1. **Derive events-spine publisher** into `src/events/` with provenance markings; configure it for the `si.identity.*` subject prefix (the SI namespace, not `asi`).
2. **Wire publishers** into three state-changing flows:
   - `si.identity.login.completed` — emitted on successful `verifyCode` returning a token
   - `si.identity.grant.recorded` — emitted on successful grant append
   - `si.identity.revoke.recorded` — emitted on successful revoke append
3. **Update events-spine Hypothesis H6 and H7 in the asi SIG** at completion, with evidence. Generate a Right-Bookend snapshot rendered from the SIG.

Tag identity at `v0.2.2-pre`.

## Out of scope

- Deriving the subscriber, Scribe, or MCP server — SI/I is a publisher-only adoption for now. Subscribers come when a real consumer (e.g. Completeness Agent) needs them.
- Loading SI/I's own SIG into PolyGraph — SI/I doesn't have its own Solution root in PolyGraph; that's a future restructure (when SI/I becomes part of a wider constellation deployment).
- Updating SI/I to publish to a *different* SIG (a hypothetical "SI Solution" root in PolyGraph). For now, the asi SIG is where Hypothesis updates land because that's where the events-spine Contract was loaded.
- Modifying events-spine's reference-impl — derive only.
- Modifying `archetypes/events-spine/DEFECTS.md` directly — defects discovered during adoption go into the FINDINGS file; we lift them to DEFECTS.md as a separate refresh task.

## Hard constraints

- **events-spine reference-impl at `archetypes/events-spine/reference-impl/` is READ-ONLY.** Derive, mark provenance, do not push back.
- **Marker discipline:** the reference-impl carries no `@adopt:` markers (events-spine is a primitive composition; markers were the solution-intel pattern). Adopters configure events-spine via constructor arguments and config — no source-file editing of defaults.
- **Provenance JSDoc** on every derived file: cite source path + commit + adoption profile.
- **Subject namespace:** `si.identity.*` (SI/I uses the `si` namespace; archetypes-solution-intelligence uses `asi.*`). The publisher's subject prefix is configured at boot.
- **No tokens or credentials in event payloads** (events-spine C5). Login event carries `email`, NOT the code or the token. Grant/revoke events carry the audit-block sequence + subject/action identifiers, NOT the token.
- **Use os.tmpdir() not /tmp/.**
- **No batched source-file writes.** Each file individually; `npx tsc --noEmit` at every major boundary.
- **Watch the esbuild trap.** Do not write `*/` inside `//` line comments inside `/** */` blocks.
- **All existing tests stay green** (current SI/I has 70 tests; new total ≥ 70 with the additions).
- **Wall-clock cap: 4 hours.** If close to cap, prioritize getting publishers working + integration test green + tag v0.2.2-pre; defer the SIG writeback to a small follow-up commit and note in FINDINGS.

## SIG read and write protocol

This is the second sub-agent run driven by a SIG-realized contract (events-spine build was the first). The pattern:

### Reading the events-spine contract

Query the asi SIG (`bolt://localhost:7689`, auth `neo4j / udt-pass-2026`) for the events-spine Contract subgraph. Use the same code patterns as the events-spine build — the writeback scripts from that build live at `~/.openclaw/workspace/artifacts/archetypes/events-spine/scripts/` (or wherever they landed per the events-spine FINDINGS).

The Contract's Services, Constraints, DataObjects tell you the publisher's contract — what shape ScribeEvent must have, what the publish() signature is, what the subject-naming convention requires.

### Writing back at completion

Update **events-spine's** H6 and H7 Hypothesis nodes in the asi SIG:

- **H6 — Stage 2d adopts events-spine without per-adopter customization beyond configuration:**
  - status `held` if you successfully derived the publisher and wired it into SI/I with ONLY configuration changes (subject prefix, NATS URL, publisher id) and no source-file modification of the reference-impl
  - status `partial` if you had to modify the reference-impl in any way; evidence cites the modification
  - status `violated` if customization required substantive changes to the reference-impl that should flow back to events-spine itself
- **H7 — Stage 2d wall-clock stayed within estimate:**
  - status `held` if wall-clock ≤4 hours (the cap)
  - status `partial` if wall-clock exceeded estimate but completed
  - evidence cites actual wall-clock

Use the writeback pattern established in the events-spine build:

```cypher
MATCH (c:Contract {archetypeName: "events-spine"})-[:DECLARES_HYPOTHESIS]->(h:Hypothesis {key: $key})
SET h.status = $status, h.evidence = $evidence, h.verifiedAt = datetime()
```

### Generating the snapshot

After writeback, render an updated `archetypes/events-spine/RIGHT-BOOKEND-snapshot-2026-05-21.md` (overwrite the existing snapshot from the build run; it now reflects post-adoption state with H6+H7 updated). Or write a new file `RIGHT-BOOKEND-snapshot-after-stage-2d-2026-05-21.md` — your call; document the choice in FINDINGS.

Commit the updated snapshot to the **archetypes repo** (cross-repo commit; the snapshot is the archetype's, not the adopter's).

## Repo + branch

- Repo: `wfredricks/solution-intelligence-identity` (existing; currently at v0.2.0-pre)
- Branch: `stage-2d-events-spine-adoption`
- Single PR, squash-merge on completion
- Tag the merged commit `v0.2.2-pre` (this is identity's third version bump)

Cross-repo write: `wfredricks/archetypes` for the updated snapshot + a small ADOPTIONS.md update (add "solution-intelligence-identity" to events-spine/ADOPTIONS.md and to events-spine/ARCHETYPE.yaml#adopters).

## Phases

### Phase A — Branch + sanity check

A1. `cd ~/.openclaw/workspace/artifacts/si-runtime/identity && git checkout main && git pull && git checkout -b stage-2d-events-spine-adoption`

A2. Verify the asi PolyGraph is reachable (`bolt://localhost:7689`). If not, `docker start constellation-neo4j`. If still unreachable, partial FINDINGS + Signal.

A3. Run baseline: `npm install && npm test`. Confirm 70/70 tests pass before any changes.

A4. Query the events-spine Contract from the SIG (read-only); cache the response. Use the writeback scripts from the events-spine build, or write a small inline Cypher query.

### Phase B — Derive events-spine publisher

B1. Create directory `src/events/` (likely doesn't exist; if it does, you're adding to it).

B2. For each file in `~/.openclaw/workspace/artifacts/archetypes/events-spine/reference-impl/src/publisher/`:
- Read the file
- Add provenance JSDoc header:
```typescript
/**
 * Derived from archetypes/events-spine/reference-impl/src/publisher/<file>
 * Source archetype: events-spine
 * Source commit: <tag: events-spine-v0.1.0-pre>
 * Adoption: solution-intelligence-identity Stage 2d
 * Adopted at: 2026-05-21
 * Modifications: <list any beyond namespace configuration, or "none — configuration-only">
 */
```
- Copy the file content as-is (no source modifications expected — events-spine has no @adopt: markers; it's configured at runtime)
- Save into `src/events/publisher/<file>`

B3. Also derive the `src/types.ts` ScribeEvent type and related interfaces — adopter needs these to construct typed events.

B4. Run `npx tsc --noEmit`. Must pass.

B5. Commit: `Stage 2d: derive events-spine publisher into src/events/`.

### Phase C — Configure the SI publisher

C1. Create `src/events/si-publisher.ts`:
- Wraps the derived Publisher
- Constructor takes a `PublisherOptions` configured for SI/I:
  - `natsUrl`: from env `NATS_URL` (default `nats://localhost:4222`)
  - `publisherId`: `"solution-intelligence-identity"` (or similar — distinct from any other publisher in the constellation)
  - `subjectPrefix`: `"si.identity"` (NOT `asi.identity` — SI/I uses the `si` namespace)
- Exposes typed methods for the three events SI/I publishes:
  - `publishLoginCompleted(email: string)` — emits `si.identity.login.completed` with payload `{ email }`
  - `publishGrantRecorded(grant: GrantData)` — emits `si.identity.grant.recorded` with payload `{ subject, principal, action, resource, auditBlockSeq }`
  - `publishRevokeRecorded(revoke: RevokeData)` — emits `si.identity.revoke.recorded` with payload `{ subject, principal, action, resource, auditBlockSeq }`
- Provides graceful no-op behavior when NATS is unreachable: log warning, don't throw (events are observability, not correctness-critical for SI/I's primary flow)

C2. Provenance JSDoc on this file too (cites events-spine as the source archetype it composes; modifications: "SI-specific subject prefix and typed event wrappers").

C3. Add unit tests in `tests/events/si-publisher.test.ts`:
- Mocks NATS; verifies each publish method emits the correct subject and payload shape
- Verifies graceful no-op when NATS connection fails
- Verifies no tokens or credentials appear in any payload (event-spine C5 enforcement)

C4. Run gates: `tsc --noEmit`, `npm test`, `npm run lint`. All green.

C5. Commit.

### Phase D — Wire publishers into SI/I flows

D1. Identify the three call sites:
- **Login completion:** in `src/auth/server.ts` (or wherever `verifyCode` returns a token to the client). Find the spot after the token is generated, before the response is sent.
- **Grant recording:** in `src/grants-http.ts` (the POST handler that creates a grant entry in the audit ledger). Find the spot after the audit-block sequence number is assigned, before the response.
- **Revoke recording:** same file as grant; symmetric flow.

D2. At each call site, after the audit-write succeeds:
- Get a reference to the SI publisher (initialized at server boot; injected via constructor or a module-level singleton)
- Call the appropriate `publish*` method
- Wrap in a try/catch — publish failures must NOT fail the user-facing operation
- Add a `// Why:` comment naming the events-spine Service (S1) being realized and the SI flow

D3. Initialize the publisher at server boot — likely in `src/server.ts` or `src/index.ts` wherever the server starts up. Connect to NATS; pass the publisher reference to handlers that need it.

D4. Add a graceful shutdown: when the server stops, drain the publisher cleanly.

D5. Run gates. All green.

D6. Commit: `Stage 2d: wire si.identity.* event publishers into login, grant, revoke flows`.

### Phase E — Integration test

E1. Add `tests/integration/events-emit.test.ts`:
- Boots SI/I against a real NATS server (testcontainers or in-process; same pattern as events-spine's integration test)
- Subscribes to `si.identity.*` with a test subscriber that captures events
- Drives the three flows:
  - Login: request a code (use SI_DEV_CODE=123456 like events-spine's test); verify the code; assert `si.identity.login.completed` event received with the email
  - Grant: POST a grant; assert `si.identity.grant.recorded` event received with the correct shape
  - Revoke: DELETE a grant; assert `si.identity.revoke.recorded` event received
- **Critical:** assert event payloads do NOT contain the token or the login code (constraint C5)

E2. Run the integration test. Must pass.

E3. Run full test suite. All tests green (existing 70 + new units + new integration = ~75+ total).

E4. Commit.

### Phase F — Update events-spine ADOPTIONS

F1. Edit `~/.openclaw/workspace/artifacts/archetypes/events-spine/ADOPTIONS.md`:
- Add the first entry:
```markdown
## solution-intelligence-identity (Stage 2d, 2026-05-21)

First adoption. Derived publisher into `src/events/`. Wired into login/grant/revoke flows. Subject prefix `si.identity.*`. Tag: v0.2.2-pre.
```

F2. Edit `~/.openclaw/workspace/artifacts/archetypes/events-spine/ARCHETYPE.yaml`:
- Update `adopters` from `[]` to include `solution-intelligence-identity (Stage 2d, v0.2.2-pre)`

F3. Commit on the archetypes repo (NOT the identity repo) on a separate branch — `events-spine-adopter-update-2026-05-21`. Open PR, squash-merge.

### Phase G — SIG writeback for H6 and H7

G1. Compute `H6` status:
- If you derived publisher without modifying any reference-impl source file (configuration-only adoption): `held`
- If you had to modify any reference-impl file in the adoption: `partial` or `violated`; evidence cites modifications
- Evidence: cite the provenance JSDoc headers and the SI-publisher wrapper as the only customization (which is configuration, not source-file modification)

G2. Compute `H7` status:
- Wall-clock from Phase A start to end of integration test
- If ≤4 hours: `held`. Evidence: actual wall-clock in minutes.
- If >4 hours: `partial`. Evidence cites the time and what slowed it down.

G3. Run the writeback against `bolt://localhost:7689`:
```cypher
MATCH (c:Contract {archetypeName: "events-spine"})-[:DECLARES_HYPOTHESIS]->(h:Hypothesis {key: "H6"})
SET h.status = $h6_status, h.evidence = $h6_evidence, h.verifiedAt = datetime();

MATCH (c:Contract {archetypeName: "events-spine"})-[:DECLARES_HYPOTHESIS]->(h:Hypothesis {key: "H7"})
SET h.status = $h7_status, h.evidence = $h7_evidence, h.verifiedAt = datetime();
```

G4. Verify via `asi contracts show events-spine` — H6 and H7 should now show status + evidence (no longer "untested").

G5. Render an updated snapshot: overwrite `~/.openclaw/workspace/artifacts/archetypes/events-spine/RIGHT-BOOKEND-snapshot-2026-05-21.md` with the post-Stage-2d SIG state. Commit on the archetypes repo (same branch as Phase F, OR a follow-up — your call).

### Phase H — PR + merge + tag (identity repo)

H1. Push identity branch.

H2. Open PR titled `Stage 2d: events-spine adoption (publisher wired into login/grant/revoke)`. PR body summarizes:
- events-spine derivation pattern (provenance JSDoc, no source modifications)
- Three publishers wired
- Integration test asserting events fire + no credentials leak
- SIG writeback (H6 + H7 updated)

H3. Wait for CI green. Squash-merge.

H4. Tag `v0.2.2-pre`. Push tag. Create GitHub release citing CHANGELOG.

H5. CHANGELOG entry on identity repo:
```markdown
## 0.2.2-pre — 2026-05-21

Stage 2d: adopt the events-spine archetype.

- Derived events-spine publisher into `src/events/` with provenance markings
- Wired publishers into login, grant, revoke flows
  - `si.identity.login.completed` on successful verifyCode
  - `si.identity.grant.recorded` on successful grant append
  - `si.identity.revoke.recorded` on successful revoke append
- No tokens or credentials in any event payloads (events-spine C5)
- Integration test booting SI/I + NATS subscriber asserts events fire correctly
- Updated events-spine Hypothesis H6 + H7 in the asi SIG with status + evidence
- events-spine ADOPTIONS.md and ARCHETYPE.yaml updated to record this adoption
```

### Phase I — FINDINGS + Signal

I1. Write `~/.openclaw/workspace/artifacts/si-runtime/identity/build-history/BUILD-STAGE-02D-FINDINGS.md`.

Sections:
- What shipped
- What worked smoothly (lessons confirmed)
- What surprised (especially: any defects in events-spine discovered during adoption — these belong in `archetypes/events-spine/DEFECTS.md` at the next refresh)
- Wall-clock breakdown
- Hard-constraints compliance check
- H6 and H7 final status values + evidence
- Recommendations for Stage 3 (chainblocks → simple-ledger → SI/G)

I2. Commit FINDINGS to the identity repo.

I3. **Signal Bill at +17176608721:**
"Stage 2d complete: SI/I adopts events-spine. Publishers wired (si.identity.login.completed, .grant.recorded, .revoke.recorded). Integration test green. SIG: events-spine Hypothesis H6 = <status>, H7 = <status>. https://github.com/wfredricks/solution-intelligence-identity/releases/tag/v0.2.2-pre"

## Wall-clock estimate

- Phase A (branch + baseline): ~10 min
- Phase B (derive publisher): ~20 min
- Phase C (configure SI publisher): ~30-45 min
- Phase D (wire into flows): ~30-45 min
- Phase E (integration test): ~30-45 min
- Phase F (events-spine ADOPTIONS update): ~10 min
- Phase G (SIG writeback): ~15-20 min
- Phase H (PR + merge + tag): ~10 min
- Phase I (FINDINGS + Signal): ~15 min

Total expected: **~2.5-3.5 hours.** Hard cap **4 hours.** If close to cap, prioritize identity green + tag + Signal; defer the SIG writeback + snapshot to a small follow-up commit. Document the deferral in FINDINGS.

## Output checklist

- [ ] Branch `stage-2d-events-spine-adoption` created on identity repo
- [ ] events-spine publisher derived into `src/events/` with provenance headers
- [ ] `src/events/si-publisher.ts` exposes typed publish methods
- [ ] Three publishers wired into login, grant, revoke flows (with try/catch graceful failure)
- [ ] Server boot initializes publisher; graceful shutdown drains it
- [ ] Integration test asserts all three events fire AND no credentials leak
- [ ] All existing tests pass; new tests added
- [ ] identity tagged `v0.2.2-pre` with GitHub release
- [ ] events-spine/ADOPTIONS.md updated on archetypes repo (PR squash-merged)
- [ ] events-spine/ARCHETYPE.yaml `adopters` list updated
- [ ] H6 and H7 updated in the asi SIG with status + evidence + verifiedAt
- [ ] RIGHT-BOOKEND snapshot regenerated and committed (archetypes repo)
- [ ] `asi contracts show events-spine` shows H6 and H7 as no-longer-untested
- [ ] BUILD-STAGE-02D-FINDINGS.md committed to identity repo
- [ ] Signal sent to Bill

## Notes for the sub-agent

- This is the **first adoption to update an existing archetype's Hypothesis status nodes.** The pattern: every adoption teaches the archetype; teachings flow back as SIG updates. Take care with the H6/H7 evidence — future archetype users will read it.
- events-spine has NO `@adopt:` markers (it's a primitive composition, not a substrate; configured at runtime, not at source level). Don't look for them. The configuration happens in the SI-publisher wrapper (Phase C).
- If you discover a defect in events-spine during adoption (e.g. a constraint that's hard to honor, an API that's awkward, a missing type export), document in FINDINGS but do NOT modify events-spine. That's a refresh-task concern.
- The asi SIG holds events-spine's contract because the archetypes registry hosts its contracts there. SI/I doesn't need its own SIG for this Stage; future stages will likely give SI/I its own Solution root in the constellation graph, but that's downstream.
- Cross-repo writes (this task touches both `wfredricks/solution-intelligence-identity` AND `wfredricks/archetypes`) — manage branches and PRs carefully. Two separate PRs. The identity PR contains the adoption code; the archetypes PR contains the ADOPTIONS update + snapshot refresh.
- Watch for the esbuild trap. Watch for `os.tmpdir()` vs `/tmp/`. Watch for marker comment preservation (events-spine reference-impl has its own JSDoc; preserve those when copying — add your provenance header ABOVE the existing JSDoc, not replacing it).
