/**
 * SI/I — Event Publisher (events-spine adopter wrapper)
 *
 * Composes archetypes/events-spine — https://github.com/wfredricks/archetypes
 * Source archetype: events-spine (composite) at commit
 *   1b334abbb354fa89dd758225e960ce5f58dcf365 (tag events-spine-v0.1.0-pre).
 *
 * Pattern: events-spine — simple-pubsub primitive (Service S1) wrapped
 *   with SI-specific subject prefix, publisherId, and typed
 *   per-event-kind methods.
 * Adopted for: SI/I identity service, Stage 2d.
 *
 * Maintenance ownership: SI core team.
 *
 * Modifications from upstream: configuration-only.
 *   - Subject prefix: `si.identity.*` (adopter-owned namespace per
 *     METHODOLOGY.md §Archetype-owned vs. adopter-owned).
 *   - Publisher id: `solution-intelligence-identity` (adopter-owned).
 *   - Adds typed per-event methods (`publishLoginCompleted`,
 *     `publishGrantRecorded`, `publishRevokeRecorded`) so callers in
 *     SI/I emit through a narrow, schema-aware surface. The underlying
 *     `events-spine` Publisher (`src/events/publisher/`) is composed
 *     verbatim — no source-file modification of the reference-impl.
 *   - Wraps every publish call in graceful no-op semantics (try/catch
 *     + log) so a NATS outage does NOT fail the user-facing operation
 *     (login, grant, revoke). Events are observability; the audit
 *     ledger (`src/audit.ts`) remains the correctness-bearing record.
 *
 * Honors events-spine constraints:
 *   - C5: NO tokens or login codes appear in any payload. Login event
 *     carries the email only. Grant/revoke events carry subject/
 *     principal/action/resource + the audit-block sequence number.
 *
 * @module events/si-publisher
 */

import type { Publisher } from './publisher/index.js';
import { createPublisher } from './publisher/index.js';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Default NATS URL when `NATS_URL` is not set. */
const DEFAULT_NATS_URL = 'nats://localhost:4222';

/**
 * Adopter-owned identifier for this publisher. Recorded on every event;
 * informational only (P3: the bus is trusted within the constellation).
 */
export const SI_IDENTITY_PUBLISHER_ID = 'solution-intelligence-identity';

/**
 * Adopter-owned subject prefix. The events-spine Contract leaves the
 * namespace under the adopter's control (METHODOLOGY.md §Archetype-owned
 * vs. adopter-owned: "subject prefix swaps; pattern stays").
 *
 * SI/I publishes under `si.identity.*`. archetypes-solution-intelligence
 * (the asi twin) publishes under `asi.identity.*`. The events-spine
 * archetype itself prescribes neither prefix.
 */
export const SI_IDENTITY_SUBJECT_PREFIX = 'si.identity';

/** Concrete subjects this publisher emits. */
export const SI_IDENTITY_SUBJECTS = {
  loginCompleted: `${SI_IDENTITY_SUBJECT_PREFIX}.login.completed`,
  grantRecorded: `${SI_IDENTITY_SUBJECT_PREFIX}.grant.recorded`,
  revokeRecorded: `${SI_IDENTITY_SUBJECT_PREFIX}.revoke.recorded`,
} as const;

/**
 * Options accepted by {@link createSiIdentityPublisher}. All fields are
 * optional; sensible defaults pull from process env.
 */
export interface SiIdentityPublisherOptions {
  /** Override the NATS URL (default: `process.env.NATS_URL` or `nats://localhost:4222`). */
  natsUrl?: string;
  /** Override the publisher id (default: {@link SI_IDENTITY_PUBLISHER_ID}). */
  publisherId?: string;
  /**
   * Inject an alternative underlying Publisher. Used by tests to swap
   * in a fake (no real NATS connection) without touching the
   * archetype's reference-impl.
   */
  underlying?: Publisher;
  /**
   * Logger for graceful-no-op warnings. Defaults to `console`. Any
   * shape with a `.warn(message, meta?)` method satisfies the
   * interface — the SI core logger plugs in here in v0.3.
   */
  logger?: { warn(message: string, meta?: unknown): void };
}

// ─── Payload shapes ──────────────────────────────────────────────────────────

/**
 * Payload for `si.identity.login.completed`.
 *
 * // Why no token and no login code: events-spine constraint C5
 * // forbids credentials in event payloads. The Scribe records
 * // faithfully and does not redact; the obligation is upstream
 * // (here).
 */
export interface LoginCompletedPayload {
  /** Email that successfully verified a one-time code. */
  email: string;
  /** SI projectId the token was issued against. */
  projectId: string;
}

/**
 * Payload for `si.identity.grant.recorded`.
 *
 * // Why we include `auditBlockSeq`: subscribers (Scribe, downstream
 * // agents) correlate the event to the chainblocks audit ledger row.
 * // Why we DO NOT include the actor's token: C5 (no credentials).
 */
export interface GrantRecordedPayload {
  /** Actor who issued the grant (email). */
  actor: string;
  /** Project the grant scopes (the resource being granted on). */
  projectId: string;
  /** Subject of the grant (email being granted a role). */
  targetUserId: string;
  /** Role being granted (Owner/Operator/Analyst/Reviewer/Customer). */
  role: string;
  /** Sequence number of the corresponding audit-ledger block. */
  auditBlockSeq: number;
}

/**
 * Payload for `si.identity.revoke.recorded`. Symmetric to grant.
 */
export interface RevokeRecordedPayload {
  /** Actor who revoked the grant (email). */
  actor: string;
  /** Project the revoked grant scoped. */
  projectId: string;
  /** Subject whose grant was revoked. */
  targetUserId: string;
  /** Role that was revoked. */
  role: string;
  /** Sequence number of the corresponding audit-ledger block. */
  auditBlockSeq: number;
}

// ─── Publisher surface ───────────────────────────────────────────────────────

/**
 * The SI/I event-publishing surface. Wraps the events-spine Publisher
 * with typed, schema-aware methods for the three events SI/I emits.
 *
 * All publish methods are SAFE: a NATS outage logs a warning and
 * returns; it does NOT throw, and it does NOT fail the user-facing
 * operation that drove the event.
 */
export interface SiIdentityPublisher {
  /** Open the underlying NATS connection. Idempotent. */
  connect(): Promise<void>;
  /** Emit `si.identity.login.completed`. */
  publishLoginCompleted(payload: LoginCompletedPayload, correlationId?: string): void;
  /** Emit `si.identity.grant.recorded`. */
  publishGrantRecorded(payload: GrantRecordedPayload, correlationId?: string): void;
  /** Emit `si.identity.revoke.recorded`. */
  publishRevokeRecorded(payload: RevokeRecordedPayload, correlationId?: string): void;
  /** Drain and close the underlying NATS connection. Idempotent. */
  close(): Promise<void>;
}

/**
 * Construct an SI/I event publisher.
 *
 * // Why a factory: mirrors the events-spine reference-impl's
 * // `createPublisher` factory shape. Keeps the adopter surface
 * // paradigm-neutral.
 */
export function createSiIdentityPublisher(
  options: SiIdentityPublisherOptions = {},
): SiIdentityPublisher {
  const logger = options.logger ?? console;
  const underlying: Publisher =
    options.underlying ??
    createPublisher({
      natsUrl: options.natsUrl ?? process.env.NATS_URL ?? DEFAULT_NATS_URL,
      publisherId: options.publisherId ?? SI_IDENTITY_PUBLISHER_ID,
    });

  let connected = false;
  let connectPromise: Promise<void> | null = null;
  let closed = false;

  async function ensureConnected(): Promise<void> {
    if (connected || closed) return;
    if (!connectPromise) {
      connectPromise = underlying.connect().then(() => {
        connected = true;
      });
    }
    await connectPromise;
  }

  function safePublish(
    subject: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): void {
    if (closed) return;
    if (!connected) {
      // Why graceful no-op: if the server boots without NATS available
      // (e.g. dev iteration, or NATS is temporarily down), we do NOT
      // want every login/grant/revoke to throw. The event is
      // observability; the audit ledger is the correctness record.
      logger.warn('si-identity-publisher: publish skipped (not connected)', {
        subject,
      });
      return;
    }
    try {
      underlying.publish({
        subject,
        payload,
        publisherId: SI_IDENTITY_PUBLISHER_ID,
        ...(correlationId !== undefined ? { correlationId } : {}),
      });
    } catch (err) {
      // Why catch + log: NATS publish can throw if the connection
      // drops between connect() and publish() (rare, but real). We
      // log and return rather than propagate.
      logger.warn('si-identity-publisher: publish threw; swallowing', {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    async connect(): Promise<void> {
      try {
        await ensureConnected();
      } catch (err) {
        // Why graceful no-op on connect failure: same rationale as
        // safePublish — the server should boot even if NATS is
        // unreachable. Subsequent publish calls will hit the
        // "not connected" branch and log+skip.
        logger.warn('si-identity-publisher: connect failed; events disabled', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    publishLoginCompleted(payload: LoginCompletedPayload, correlationId?: string): void {
      // Why explicit cast to Record<string, unknown>: TypeScript's
      // structural typing accepts interface → Record where every key
      // is JSON-serializable, but the cast makes the boundary
      // explicit at the publish seam.
      safePublish(
        SI_IDENTITY_SUBJECTS.loginCompleted,
        payload as unknown as Record<string, unknown>,
        correlationId,
      );
    },
    publishGrantRecorded(payload: GrantRecordedPayload, correlationId?: string): void {
      safePublish(
        SI_IDENTITY_SUBJECTS.grantRecorded,
        payload as unknown as Record<string, unknown>,
        correlationId,
      );
    },
    publishRevokeRecorded(payload: RevokeRecordedPayload, correlationId?: string): void {
      safePublish(
        SI_IDENTITY_SUBJECTS.revokeRecorded,
        payload as unknown as Record<string, unknown>,
        correlationId,
      );
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        await underlying.close();
      } catch {
        // already closed / never connected
      }
    },
  };
}

// ─── Module-level singleton (server-process scope) ───────────────────────────

let _instance: SiIdentityPublisher | null = null;

/**
 * Lazily construct the process-wide SI/I publisher. Server boot calls
 * `connect()` on it; handlers reach for it via this accessor.
 *
 * // Why a singleton: there is one NATS connection per server process;
 * // every handler shares it. The accessor matches the lazy-singleton
 * // pattern already used in `src/auth/server.ts` for the key store.
 */
export function getSiIdentityPublisher(): SiIdentityPublisher {
  if (!_instance) {
    _instance = createSiIdentityPublisher();
  }
  return _instance;
}

/**
 * Override the process-wide publisher (test-only, and for server-boot
 * dependency injection). Returns the previous instance so callers can
 * restore.
 *
 * // Why exposed: tests inject a fake publisher (no real NATS) into
 * // the module-level slot so handlers reach a controllable seam.
 */
export function _setSiIdentityPublisherForTests(
  next: SiIdentityPublisher | null,
): SiIdentityPublisher | null {
  const prev = _instance;
  _instance = next;
  return prev;
}

/**
 * Reset the singleton. After this, the next `getSiIdentityPublisher()`
 * call constructs a fresh instance.
 *
 * // Why distinct from `_setSiIdentityPublisherForTests(null)`: same
 * // semantics, but reads more clearly at call sites.
 */
export function _resetSiIdentityPublisherForTests(): void {
  _instance = null;
}
