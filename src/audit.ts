/**
 * SI/I — Chainblocks Audit Emission Wrapper
 *
 * // Why: SI emits audit events for every role grant and revocation. The
 * // canonical sink is chainblocks (per MODEL.md §3). Stage 2a does NOT wire
 * // real chainblocks integration; instead this wrapper writes the canonical
 * // payload to a JSONL fallback at `<root>/data/chainblocks/si.audit.jsonl`
 * // and returns the per-process monotonic sequence number. Stage 2c (or a
 * // polish pass) will replace the fallback with the real chainblocks client.
 *
 * // Why expose a stable interface now: every caller in SI/I (grants-http,
 * // future revoke flow, future seal flow) calls these two functions. When
 * // the real integration lands, only this file changes.
 *
 * @module audit
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// ─── Sequence number ─────────────────────────────────────────────────────────

/**
 * Per-process monotonic audit-block sequence.
 *
 * // Why: Real chainblocks issues globally-ordered block numbers. The fallback
 * // sink approximates that with a local monotonic counter; on restart it
 * // recovers from the on-disk JSONL by counting existing lines so callers
 * // see strictly-increasing values within a workspace.
 */
let _seq = -1;

/**
 * Reset the in-memory sequence counter. Test-only helper.
 *
 * // Why: Vitest needs deterministic state across describe blocks. Production
 * // callers must never invoke this.
 */
export function _resetSeqForTests(): void {
  _seq = -1;
}

// ─── Path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the audit-log JSONL path.
 *
 * // Why: Defaults to `<cwd>/data/chainblocks/si.audit.jsonl`; overridable
 * // via `SI_AUDIT_PATH` for tests and alternative deployments.
 */
export function auditLogPath(): string {
  return (
    process.env.SI_AUDIT_PATH ??
    path.join(process.cwd(), 'data', 'chainblocks', 'si.audit.jsonl')
  );
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function recoverSeqFromDisk(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.length - 1; // last seq, -1 if file empty
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return -1;
    throw err;
  }
}

async function nextSeq(): Promise<number> {
  if (_seq < 0) {
    _seq = await recoverSeqFromDisk(auditLogPath());
  }
  _seq += 1;
  return _seq;
}

// ─── Canonical payload shape ─────────────────────────────────────────────────

export interface AuditEventBase {
  /** Block sequence (monotonic, per-process for v0.1). */
  seq: number;
  /** ISO-8601 UTC emission timestamp. */
  ts: string;
  /** Event type per MODEL.md §3.2. */
  type: 'si.role.granted' | 'si.role.revoked';
  /** Who triggered the event (userId of the Owner). */
  actor: string;
  /** Project scope of the event. */
  projectId: string;
  /** Target subject of the event. */
  targetUserId: string;
  /** Role affected by the event. */
  role: string;
}

interface EmitPayload {
  actor: string;
  projectId: string;
  targetUserId: string;
  role: string;
}

async function emit(type: AuditEventBase['type'], payload: EmitPayload): Promise<number> {
  const filePath = auditLogPath();
  await ensureDir(filePath);
  const seq = await nextSeq();
  const event: AuditEventBase = {
    seq,
    ts: new Date().toISOString(),
    type,
    actor: payload.actor,
    projectId: payload.projectId,
    targetUserId: payload.targetUserId,
    role: payload.role,
  };
  // Why: append-mode write + JSONL line so the file remains a valid audit
  // stream readable by any line-oriented tool.
  await fs.appendFile(filePath, JSON.stringify(event) + '\n', { mode: 0o600 });
  return seq;
}

/**
 * Emit an `si.role.granted` audit event and return its seq.
 *
 * // Why: Called from `src/grants-http.ts` immediately before persisting the
 * // grant row. Caller embeds the returned seq in the RoleGrant as `auditBlock`
 * // so the ledger and audit stream stay cross-referenced.
 */
export async function emitGrantEvent(payload: EmitPayload): Promise<number> {
  return emit('si.role.granted', payload);
}

/**
 * Emit an `si.role.revoked` audit event and return its seq.
 */
export async function emitRevokeEvent(payload: EmitPayload): Promise<number> {
  return emit('si.role.revoked', payload);
}
