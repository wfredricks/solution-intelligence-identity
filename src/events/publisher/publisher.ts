/**
 * Adapted from archetypes/events-spine — https://github.com/wfredricks/archetypes
 * Source commit: 1b334abbb354fa89dd758225e960ce5f58dcf365
 * Source path: events-spine/reference-impl/src/publisher/publisher.ts (events-spine-v0.1.0-pre)
 *
 * Pattern: events-spine (composite) — simple-pubsub primitive realizing
 *   Service S1 (`publish(event: ScribeEvent): void`) from the
 *   events-spine SIG Contract.
 * Adopted for: SI/I identity service, Stage 2d (events-spine publisher
 *   adoption).
 *
 * Maintenance ownership: SI core team. Refresh policy: review at every
 *   events-spine minor version bump. Emergency-refresh on any change to
 *   the canonical publisher Service contract (S1).
 *
 * Modifications from upstream:
 *   - none — copied verbatim. events-spine reference-impl has no
 *     `@adopt:` markers (primitive composition; configured at runtime
 *     via constructor options). The `subjectPrefix` and `publisherId`
 *     adopter-owned namespacing happens in
 *     `src/events/si-publisher.ts` (the SI-specific wrapper), not by
 *     editing this file.
 *
 * Publisher reference — realizes Service S1 from the events-spine SIG
 * Contract.
 *
 * SIG anchor:
 *   `Service {key: "S1", contractId: "events-spine-v0.1.0-pre"}` —
 *   signature `publish(event: ScribeEvent): void` with `close(): Promise<void>`.
 *
 * Honors:
 *   - P3 (bus is lossy by default): fire-and-forget; no wait for
 *     subscriber acknowledgement.
 *   - DO1 (ScribeEvent shape): the published envelope IS a `ScribeEvent`.
 *   - C5 (no tokens in payloads): the publisher does NOT inspect or
 *     redact payloads; the obligation is upstream of this module.
 *
 * // Why `connect()` is exposed (rather than lazy-connecting on first
 * // publish): adopters benefit from an explicit "I'm ready" signal in
 * // their boot sequence so failures (DNS, auth, connectivity) surface
 * // at boot rather than on the first user-triggered publish.
 *
 * @module events/publisher/publisher
 */

import { connect, type NatsConnection, JSONCodec, StringCodec } from 'nats';
import { v7 as uuidV7 } from 'uuid';

import type { ScribeEvent } from '../types.js';

/**
 * Options accepted by `createPublisher`.
 *
 * `defaultSubject` is optional; when supplied, callers may use the
 * convenience `publishPayload` form. The contract-bearing form,
 * `publish(event)`, requires an explicit subject inside the event.
 */
export interface PublisherOptions {
  /** NATS server URL, e.g. `nats://localhost:4222`. */
  natsUrl: string;
  /** Stable id for this publisher (informational; recorded on every event). */
  publisherId: string;
  /** Optional default subject for the `publishPayload(payload, subject?)` convenience. */
  defaultSubject?: string;
  /**
   * Optional override for envelope id generation. Default: UUID v7.
   *
   * // Why exposed: tests need determinism; production should leave the
   * // default. Translators (Go/Rust/Python) substitute the
   * // platform-idiomatic UUID v7 implementation.
   */
  idGenerator?: () => string;
  /**
   * Optional override for the published-at timestamp. Default: `new Date().toISOString()`.
   *
   * // Why exposed: tests need deterministic timestamps.
   */
  clock?: () => string;
  /**
   * Optional injected NATS connection (testing seam). When provided,
   * the publisher uses this connection and never connects itself; on
   * close, it does NOT drain/close the injected connection — the
   * caller owns its lifecycle.
   */
  connection?: NatsConnection;
}

/**
 * The Publisher Service surface (S1).
 *
 * `publish` is synchronous from the caller's perspective: it places the
 * event on the bus and returns. It does NOT block on subscriber receipt
 * (P3). Errors that surface during placement (e.g. disconnected) are
 * thrown so the caller can decide how to respond.
 *
 * `close` drains and disconnects. Safe to call multiple times.
 */
export interface Publisher {
  /**
   * Open the underlying NATS connection. Optional — `publish` will
   * connect lazily if `connect()` was not called. Callers who want
   * boot-time failure should call `connect()` explicitly.
   */
  connect(): Promise<void>;
  /**
   * Publish a ScribeEvent to the bus on `event.subject`.
   *
   * Envelope fields (`id`, `publishedAt`, `publisherId`) are filled in
   * if the caller did not supply them — convenient for callers that
   * want to publish a payload + subject and have the substrate stamp
   * the rest.
   *
   * @throws if the underlying NATS publish fails (disconnected, etc.)
   */
  publish(event: PublishInput): void;
  /**
   * Convenience: publish a free-form payload on a subject. The envelope
   * is filled in entirely by the publisher.
   *
   * Requires either an explicit `subject` argument or a `defaultSubject`
   * in the publisher options.
   */
  publishPayload(payload: Record<string, unknown>, subject?: string, correlationId?: string): void;
  /**
   * Drain and close the underlying NATS connection. Idempotent.
   */
  close(): Promise<void>;
}

/**
 * Input accepted by `publish`. Envelope fields except `subject` and
 * `payload` are filled in by the publisher if absent.
 *
 * // Why this isn't simply `ScribeEvent`: requiring callers to mint a
 * // uuid + timestamp + publisherId for every publish is friction the
 * // primitive eliminates. The contract surface stays `ScribeEvent` —
 * // every published envelope reaching a subscriber IS a fully-formed
 * // `ScribeEvent` — but the input is forgiving.
 */
export interface PublishInput {
  subject: string;
  payload: Record<string, unknown>;
  id?: string;
  publishedAt?: string;
  publisherId?: string;
  correlationId?: string;
}

const jsonCodec = JSONCodec<ScribeEvent>();
const stringCodec = StringCodec();

/**
 * Construct a Publisher.
 *
 * // Why a factory function instead of a class: matches METHODOLOGY.md
 * // §Reference language preference for paradigm-neutral surfaces.
 * // Translators to Go/procedural-style languages map this to a struct
 * // constructor; translators to OOP languages map it to a class with
 * // the same method set; translators to functional languages map it to
 * // a record-of-functions. The factory form translates everywhere.
 */
export function createPublisher(options: PublisherOptions): Publisher {
  const idGenerator = options.idGenerator ?? (() => uuidV7());
  const clock = options.clock ?? (() => new Date().toISOString());
  const ownsConnection = options.connection === undefined;

  let connection: NatsConnection | null = options.connection ?? null;
  let closed = false;
  let connectPromise: Promise<void> | null = null;

  async function ensureConnected(): Promise<NatsConnection> {
    if (connection) return connection;
    if (!connectPromise) {
      connectPromise = (async () => {
        const c = await connect({ servers: options.natsUrl });
        connection = c;
      })();
    }
    await connectPromise;
    if (!connection) {
      throw new Error('Publisher: failed to acquire NATS connection');
    }
    return connection;
  }

  function buildEnvelope(input: PublishInput): ScribeEvent {
    return {
      id: input.id ?? idGenerator(),
      subject: input.subject,
      publishedAt: input.publishedAt ?? clock(),
      publisherId: input.publisherId ?? options.publisherId,
      payload: input.payload,
      ...(input.correlationId !== undefined
        ? { correlationId: input.correlationId }
        : {}),
    };
  }

  function publishEnvelope(envelope: ScribeEvent): void {
    if (closed) {
      throw new Error('Publisher: cannot publish after close()');
    }
    if (!connection) {
      // Why: synchronous publish requires the connection up front. If a
      // caller skips connect() entirely, we throw rather than buffer
      // silently (which would violate P3's fire-and-forget semantic by
      // hiding the placement failure).
      throw new Error('Publisher: connect() must be awaited before publish()');
    }
    // Why JSON-encode envelope (not just payload): subscribers parse the
    // full ScribeEvent off the wire; including id/publisherId/
    // publishedAt/correlationId in the bus message is the only way
    // those round-trip without a per-subject schema agreement.
    const bytes = jsonCodec.encode(envelope);
    connection.publish(envelope.subject, bytes);
  }

  return {
    async connect(): Promise<void> {
      await ensureConnected();
    },
    publish(input: PublishInput): void {
      publishEnvelope(buildEnvelope(input));
    },
    publishPayload(payload: Record<string, unknown>, subject?: string, correlationId?: string): void {
      const resolved = subject ?? options.defaultSubject;
      if (!resolved) {
        throw new Error(
          'Publisher.publishPayload: no subject argument and no defaultSubject in options',
        );
      }
      publishEnvelope(
        buildEnvelope({
          subject: resolved,
          payload,
          ...(correlationId !== undefined ? { correlationId } : {}),
        }),
      );
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (ownsConnection && connection) {
        // Why drain (not close): drain flushes in-flight publishes
        // before disconnecting — P3 is lossy, but we don't drop on the
        // floor messages already handed off to nats.js when the
        // publisher explicitly closes.
        try {
          await connection.drain();
        } catch {
          // Why swallow: if the connection is already dead, drain
          // raises; close() is idempotent by contract.
        }
        connection = null;
      }
    },
  };
}

// Why this helper is exported: tests in other modules (Scribe) parse
// envelopes from raw NATS messages; the parser lives with the publisher
// because the publisher owns the wire format.
/**
 * Parse a raw NATS message payload back into a `ScribeEvent`.
 * Throws if the bytes are not a valid JSON-encoded envelope.
 *
 * @internal — exposed for the subscriber/scribe; not part of the public
 *   Publisher Service surface.
 */
export function decodeEnvelope(bytes: Uint8Array): ScribeEvent {
  // Why fall back to string-decode then JSON.parse: JSONCodec is strict
  // about the type parameter but we want to return a plain object even
  // if the producer used a slightly different encoder.
  const text = stringCodec.decode(bytes);
  const obj = JSON.parse(text) as unknown;
  if (!isScribeEvent(obj)) {
    throw new Error('decodeEnvelope: bytes do not encode a valid ScribeEvent');
  }
  return obj;
}

function isScribeEvent(value: unknown): value is ScribeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.publishedAt === 'string' &&
    typeof v.publisherId === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}
