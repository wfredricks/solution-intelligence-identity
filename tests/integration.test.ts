/**
 * SI/I — End-to-end integration test.
 *
 * // Why: Boots the full server on an ephemeral port and walks the canonical
 * // flow: request-code → verify-code → grant → resolve → revoke → resolve.
 * // This is the load-bearing test that proves the bangauth archetype, the
 * // grants ledger, the audit emission, and the Hono composition all work
 * // together as one service.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer, type ServerHandle } from '../src/server.js';
import { _resetSeqForTests } from '../src/audit.js';
import { _resetAuthSingletonsForTests } from '../src/auth/server.js';

let handle: ServerHandle;
let baseUrl: string;

beforeAll(async () => {
  // Why: Fresh paths so the integration test doesn't trample local state.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'si-int-'));
  process.env.SI_GRANTS_PATH = path.join(dir, 'grants.jsonl');
  process.env.SI_AUDIT_PATH = path.join(dir, 'audit.jsonl');
  process.env.SI_DEV_CODE = '123456';
  process.env.SI_ALLOWED_DOMAINS = '*';
  process.env.SI_PROJECT_ID = 'p-integration';
  _resetSeqForTests();
  // Why: Reset lazy singletons so the env-var changes above are read fresh
  // when the server boots.
  _resetAuthSingletonsForTests();
  handle = await startServer(0);
  baseUrl = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(() => {
  _resetSeqForTests();
});

async function jpost(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function jget(url: string) {
  const res = await fetch(`${baseUrl}${url}`);
  const data = await res.json();
  return { status: res.status, data };
}

describe('SI/I integration', () => {
  it('GET /health returns 200 and reports the service', async () => {
    const { status, data } = await jget('/health');
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
    expect((data as Record<string, unknown>).service).toBe('si-identity');
  });

  it('walks the full request-code → verify-code → grant → resolve → revoke flow', async () => {
    // 1) Request a code
    const req = await jpost('/auth/request-code', { email: 'alice@x.com' });
    expect(req.status).toBe(200);

    // 2) Verify the code
    const verify = await jpost('/auth/verify-code', {
      email: 'alice@x.com',
      code: '123456',
    });
    expect(verify.status).toBe(200);
    const verifyBody = verify.data as { authenticated: boolean; email: string; token: string };
    expect(verifyBody.authenticated).toBe(true);
    expect(verifyBody.email).toBe('alice@x.com');
    expect(typeof verifyBody.token).toBe('string');
    const token = verifyBody.token;

    // 3) Grant alice the Operator role
    const grant = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'alice@x.com', role: 'Operator' },
      { 'x-si-actor': 'root@x.com' },
    );
    expect(grant.status).toBe(201);
    const grantBody = grant.data as { grantId: string; role: string };
    expect(grantBody.role).toBe('Operator');

    // 4) Resolve alice's token — should report Operator
    const resolve1 = await jpost('/resolve', { token });
    expect(resolve1.status).toBe(200);
    const resolveBody1 = resolve1.data as { userId: string; effectiveRoles: string[] };
    expect(resolveBody1.userId).toBe('alice@x.com');
    expect(resolveBody1.effectiveRoles).toContain('Operator');

    // 5) Revoke the grant
    const revoke = await jpost(
      `/grants/${grantBody.grantId}/revoke`,
      {},
      { 'x-si-actor': 'root@x.com' },
    );
    expect(revoke.status).toBe(200);
    const revokeBody = revoke.data as { revoked: boolean };
    expect(revokeBody.revoked).toBe(true);

    // 6) Resolve alice's token again — Operator is gone
    const resolve2 = await jpost('/resolve', { token });
    expect(resolve2.status).toBe(200);
    const resolveBody2 = resolve2.data as { effectiveRoles: string[] };
    expect(resolveBody2.effectiveRoles).not.toContain('Operator');
  });

  it('rejects /grants without X-SI-Actor', async () => {
    const res = await jpost('/grants', {
      projectId: 'p-integration',
      userId: 'eve@x.com',
      role: 'Owner',
    });
    expect(res.status).toBe(401);
  });

  it('rejects /grants with an invalid role', async () => {
    const res = await jpost(
      '/grants',
      { projectId: 'p-integration', userId: 'eve@x.com', role: 'Wizard' },
      { 'x-si-actor': 'root@x.com' },
    );
    expect(res.status).toBe(400);
  });

  it('rejects /resolve with a bad bearer token via Authorization header', async () => {
    const res = await fetch(`${baseUrl}/resolve`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });
});
