/**
 * SI/I — HTTP Handlers for `/grants` and `/grants/:grantId/revoke`
 *
 * // Why: Thin Hono handlers that compose `src/grants.ts` (ledger) with
 * // `src/audit.ts` (chainblocks emission). The two writes are sequenced so
 * // that audit fires FIRST, then the ledger row embeds the resulting seq as
 * // `auditBlock`. If audit fails, no ledger row is written. If ledger fails
 * // after audit succeeded, the audit stream carries an event with no matching
 * // ledger row — that's a recoverable inconsistency a sweep tool can repair,
 * // and the audit trail is what auditors trust.
 *
 * @module grants-http
 */

import type { Context } from 'hono';
import { appendGrant, appendRevoke, listGrants } from './grants.js';
import { emitGrantEvent, emitRevokeEvent } from './audit.js';
import { ROLES, type Role } from './types.js';

// ─── Owner gate (v0.1) ───────────────────────────────────────────────────────

/**
 * In v0.1 we accept the `X-SI-Actor` header as the asserted Owner identity.
 *
 * // Why: Full Owner-gating requires resolving the actor's token, then
 * // checking that they hold the Owner role for the target project. The token
 * // resolution path needs the auth router; full gating arrives in Stage 2b
 * // (CLI) when CLI commands carry the token directly. For Stage 2a, we
 * // accept the header so the server is callable end-to-end in tests and
 * // local dev; the gate is wired in but lenient.
 *
 * Returns the asserted actor or null if missing.
 */
function assertedActor(c: Context): string | null {
  const v = c.req.header('x-si-actor') ?? c.req.header('X-SI-Actor');
  if (!v) return null;
  return v.toLowerCase().trim();
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// ─── POST /grants ────────────────────────────────────────────────────────────

interface GrantBody {
  projectId?: string;
  userId?: string;
  role?: string;
}

/**
 * Issue a new role grant.
 *
 * Body: { projectId, userId, role }
 * Header: `X-SI-Actor: <ownerUserId>`
 */
export async function grantHandler(c: Context) {
  const actor = assertedActor(c);
  if (!actor) {
    return c.json({ error: 'Missing X-SI-Actor header' }, 401);
  }

  let body: GrantBody;
  try {
    body = (await c.req.json()) as GrantBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const projectId = body.projectId?.trim();
  const userId = body.userId?.toLowerCase().trim();
  const role = body.role;

  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  if (!userId) return c.json({ error: 'userId is required' }, 400);
  if (!isRole(role)) {
    return c.json(
      { error: `role must be one of: ${ROLES.join(', ')}` },
      400,
    );
  }

  try {
    // Why: Audit FIRST so a failed ledger write leaves a recoverable trail.
    const auditBlock = await emitGrantEvent({
      actor,
      projectId,
      targetUserId: userId,
      role,
    });
    const grant = await appendGrant(
      { projectId, userId, role, grantedBy: actor },
      auditBlock,
    );
    return c.json(grant, 201);
  } catch (err) {
    console.error('grant error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

// ─── POST /grants/:grantId/revoke ────────────────────────────────────────────

/**
 * Revoke an existing grant by id.
 *
 * Header: `X-SI-Actor: <ownerUserId>`
 */
export async function revokeHandler(c: Context) {
  const actor = assertedActor(c);
  if (!actor) {
    return c.json({ error: 'Missing X-SI-Actor header' }, 401);
  }

  const grantId = c.req.param('grantId');
  if (!grantId) {
    return c.json({ error: 'grantId is required' }, 400);
  }

  try {
    // Why: We need the grant's projectId/userId/role for the audit payload;
    // fetch via the ledger before deciding whether to emit.
    const grants = await listGrants();
    const original = grants.find((g) => g.grantId === grantId && !g.revoked);
    if (!original) {
      return c.json({ error: 'Grant not found or already revoked' }, 404);
    }

    const auditBlock = await emitRevokeEvent({
      actor,
      projectId: original.projectId,
      targetUserId: original.userId,
      role: original.role,
    });
    const revoked = await appendRevoke(grantId, actor, auditBlock);
    return c.json(revoked);
  } catch (err) {
    console.error('revoke error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

// ─── GET /grants ─────────────────────────────────────────────────────────────

/**
 * List grants. Optional `?projectId=...` filter.
 *
 * // Why: Admin / debug surface. Not Owner-gated in v0.1; in v0.2 this will
 * // require an Owner token for the requested project.
 */
export async function listGrantsHandler(c: Context) {
  const projectId = c.req.query('projectId') ?? undefined;
  try {
    const grants = await listGrants(projectId);
    return c.json({ grants });
  } catch (err) {
    console.error('list-grants error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
