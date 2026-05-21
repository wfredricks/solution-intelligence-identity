/**
 * SI/I integration test — events-spine adoption (Stage 2d).
 *
 * Boots a real `nats-server` (preferring the local Homebrew binary;
 * fallback to `docker run nats:2.10-alpine`), boots the SI/I server,
 * subscribes to `si.identity.*`, and drives the three state-changing
 * flows:
 *
 *   - request-code + verify-code → asserts si.identity.login.completed
 *   - POST /grants                → asserts si.identity.grant.recorded
 *   - POST /grants/:id/revoke     → asserts si.identity.revoke.recorded
 *
 * Critical assertions:
 *   - Each event subject matches the documented name
 *   - Each payload contains the expected fields
 *   - NO event payload contains a token, login code, password, or
 *     secret (events-spine Constraint C5)
 *
 * If no NATS option is available the suite skips cleanly with a
 * `describe.skipIf` guard.
 *
 * @module tests/integration/events-emit
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { createServer, connect as netConnect } from 'node:net';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect as natsConnect, JSONCodec, type NatsConnection } from 'nats';

import { startServer, type ServerHandle } from '../../src/server.js';
import { _resetSeqForTests } from '../../src/audit.js';
import { _resetAuthSingletonsForTests } from '../../src/auth/server.js';
import {
  _resetSiIdentityPublisherForTests,
  SI_IDENTITY_SUBJECTS,
  type LoginCompletedPayload,
  type GrantRecordedPayload,
  type RevokeRecordedPayload,
} from '../../src/events/si-publisher.js';
import type { ScribeEvent } from '../../src/events/types.js';

// ─── NATS bootstrapping ──────────────────────────────────────────────────────

function hasLocalNatsServer(): boolean {
  try {
    execSync('command -v nats-server', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasDocker(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasNatsOption(): boolean {
  return hasLocalNatsServer() || hasDocker();
}

async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === 'object' && address && 'port' in address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('could not determine free port'));
      }
    });
  });
}

async function waitForNatsReady(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const conn = netConnect({ port, host: '127.0.0.1' });
        conn.once('connect', () => {
          conn.end();
          resolve();
        });
        conn.once('error', (e: Error) => reject(e));
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`NATS did not become ready on port ${port} within ${timeoutMs}ms`);
}

interface NatsServerHandle {
  url: string;
  stop(): Promise<void>;
}

async function bootLocalNats(): Promise<NatsServerHandle> {
  const port = await pickFreePort();
  const proc = spawn('nats-server', ['-p', String(port), '-a', '127.0.0.1'], {
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const onExit = (code: number | null) => {
      if (!settled) {
        settled = true;
        reject(new Error(`nats-server exited prematurely with code ${code}`));
      }
    };
    proc.once('exit', onExit);
    proc.once('error', (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.off('exit', onExit);
        resolve();
      }
    }, 250);
  });
  await waitForNatsReady(port);
  return {
    url: `nats://127.0.0.1:${port}`,
    stop: async () => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        await waitProcExit(proc, 2000);
      }
    },
  };
}

async function bootDockerNats(): Promise<NatsServerHandle> {
  const port = await pickFreePort();
  const containerName = `si-identity-int-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const proc = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      containerName,
      '-p',
      `127.0.0.1:${port}:4222`,
      'nats:2.10-alpine',
    ],
    { stdio: 'ignore' },
  );
  await waitForNatsReady(port, 20_000);
  return {
    url: `nats://127.0.0.1:${port}`,
    stop: async () => {
      try {
        execSync(`docker kill ${containerName}`, { stdio: 'ignore' });
      } catch {
        // already gone
      }
      if (!proc.killed) {
        proc.kill('SIGTERM');
        await waitProcExit(proc, 2000);
      }
    },
  };
}

function waitProcExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, timeoutMs);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function bootNats(): Promise<NatsServerHandle> {
  if (hasLocalNatsServer()) return bootLocalNats();
  if (hasDocker()) return bootDockerNats();
  throw new Error('No NATS option available');
}

// ─── Test wiring ─────────────────────────────────────────────────────────────

describe.skipIf(!hasNatsOption())('SI/I events-spine integration', () => {
  let natsHandle: NatsServerHandle;
  let serverHandle: ServerHandle;
  let baseUrl: string;
  let subscriberConn: NatsConnection;
  const captured: ScribeEvent[] = [];

  beforeAll(async () => {
    natsHandle = await bootNats();

    // Why: fresh paths so the integration test doesn't trample local
    // state. tmpdir() per the hard constraint, not /tmp/.
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'si-events-int-'));
    process.env.SI_GRANTS_PATH = path.join(dir, 'grants.jsonl');
    process.env.SI_AUDIT_PATH = path.join(dir, 'audit.jsonl');
    process.env.SI_DEV_CODE = '123456';
    process.env.SI_ALLOWED_DOMAINS = '*';
    process.env.SI_PROJECT_ID = 'p-events-int';
    process.env.NATS_URL = natsHandle.url;

    _resetSeqForTests();
    _resetAuthSingletonsForTests();
    _resetSiIdentityPublisherForTests();

    // Why: subscribe to si.identity.> with a separate NATS client
    // BEFORE the server boots its publisher. P3 says the bus is
    // lossy; if we subscribe after the publisher, the first event
    // may be missed in flaky CI conditions.
    subscriberConn = await natsConnect({ servers: natsHandle.url });
    const sub = subscriberConn.subscribe('si.identity.>');
    const codec = JSONCodec<ScribeEvent>();
    void (async () => {
      for await (const msg of sub) {
        try {
          captured.push(codec.decode(msg.data));
        } catch {
          // ignore malformed
        }
      }
    })();

    serverHandle = await startServer(0);
    baseUrl = `http://127.0.0.1:${serverHandle.port}`;
  }, 30_000);

  afterAll(async () => {
    try {
      await serverHandle.close();
    } catch {
      // ignore
    }
    try {
      await subscriberConn.drain();
    } catch {
      // ignore
    }
    try {
      await natsHandle.stop();
    } catch {
      // ignore
    }
    _resetSiIdentityPublisherForTests();
    delete process.env.NATS_URL;
  });

  async function waitForEvent(
    subject: string,
    timeoutMs = 3000,
  ): Promise<ScribeEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ev = captured.find((e) => e.subject === subject);
      if (ev) return ev;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timed out waiting for ${subject}. Captured so far: ${JSON.stringify(
        captured.map((e) => e.subject),
      )}`,
    );
  }

  async function jpost(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = text;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        // leave as text
      }
    }
    return { status: res.status, data };
  }

  it('emits si.identity.login.completed on successful verify-code', async () => {
    // Why: request-code + verify-code is the production login flow. We
    // assert the event fires AND that no token/code appears in the
    // payload (events-spine C5).
    captured.length = 0;
    const reqRes = await jpost('/auth/request-code', { email: 'alice@x.com' });
    expect(reqRes.status).toBe(200);

    const verifyRes = await jpost('/auth/verify-code', {
      email: 'alice@x.com',
      code: '123456',
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = verifyRes.data as { authenticated: boolean; token: string };
    expect(verifyBody.authenticated).toBe(true);
    expect(verifyBody.token).toBeTruthy();

    const ev = await waitForEvent(SI_IDENTITY_SUBJECTS.loginCompleted);
    expect(ev.subject).toBe('si.identity.login.completed');
    expect(ev.publisherId).toBe('solution-intelligence-identity');

    const payload = ev.payload as unknown as LoginCompletedPayload;
    expect(payload.email).toBe('alice@x.com');
    expect(payload.projectId).toBe('p-events-int');

    // C5 enforcement: no token, no code, no password in the payload.
    const serialized = JSON.stringify(ev.payload);
    expect(serialized).not.toContain(verifyBody.token);
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toMatch(/"token"\s*:/i);
    expect(serialized).not.toMatch(/"code"\s*:/i);
    expect(serialized).not.toMatch(/"password"\s*:/i);
    expect(serialized).not.toMatch(/"secret"\s*:/i);
  });

  it('emits si.identity.grant.recorded on POST /grants', async () => {
    captured.length = 0;

    // Mint a root token so the grant gate (bearer-required) lets us
    // through.
    await jpost('/auth/request-code', { email: 'root@x.com' });
    const rootVerify = await jpost('/auth/verify-code', {
      email: 'root@x.com',
      code: '123456',
    });
    const rootToken = (rootVerify.data as { token: string }).token;

    const grantRes = await jpost(
      '/grants',
      { projectId: 'p-events-int', userId: 'bob@x.com', role: 'Operator' },
      { authorization: `Bearer ${rootToken}` },
    );
    expect(grantRes.status).toBe(201);
    const grantBody = grantRes.data as { grantId: string; auditBlock: number };

    const ev = await waitForEvent(SI_IDENTITY_SUBJECTS.grantRecorded);
    expect(ev.subject).toBe('si.identity.grant.recorded');
    expect(ev.publisherId).toBe('solution-intelligence-identity');

    const payload = ev.payload as unknown as GrantRecordedPayload;
    expect(payload.actor).toBe('root@x.com');
    expect(payload.projectId).toBe('p-events-int');
    expect(payload.targetUserId).toBe('bob@x.com');
    expect(payload.role).toBe('Operator');
    expect(payload.auditBlockSeq).toBe(grantBody.auditBlock);

    // C5 enforcement: no token leaked.
    const serialized = JSON.stringify(ev.payload);
    expect(serialized).not.toContain(rootToken);
    expect(serialized).not.toMatch(/"token"\s*:/i);
    expect(serialized).not.toMatch(/"password"\s*:/i);
  });

  it('emits si.identity.revoke.recorded on POST /grants/:id/revoke', async () => {
    captured.length = 0;

    await jpost('/auth/request-code', { email: 'root@x.com' });
    const rootVerify = await jpost('/auth/verify-code', {
      email: 'root@x.com',
      code: '123456',
    });
    const rootToken = (rootVerify.data as { token: string }).token;

    // Create a fresh grant we can revoke.
    const grantRes = await jpost(
      '/grants',
      { projectId: 'p-events-int', userId: 'carol@x.com', role: 'Analyst' },
      { authorization: `Bearer ${rootToken}` },
    );
    expect(grantRes.status).toBe(201);
    const { grantId } = grantRes.data as { grantId: string };

    captured.length = 0;
    const revokeRes = await jpost(
      `/grants/${grantId}/revoke`,
      {},
      { authorization: `Bearer ${rootToken}` },
    );
    expect(revokeRes.status).toBe(200);
    const revokeBody = revokeRes.data as { auditBlock: number; revoked: boolean };
    expect(revokeBody.revoked).toBe(true);

    const ev = await waitForEvent(SI_IDENTITY_SUBJECTS.revokeRecorded);
    expect(ev.subject).toBe('si.identity.revoke.recorded');

    const payload = ev.payload as unknown as RevokeRecordedPayload;
    expect(payload.actor).toBe('root@x.com');
    expect(payload.projectId).toBe('p-events-int');
    expect(payload.targetUserId).toBe('carol@x.com');
    expect(payload.role).toBe('Analyst');
    expect(payload.auditBlockSeq).toBe(revokeBody.auditBlock);

    const serialized = JSON.stringify(ev.payload);
    expect(serialized).not.toContain(rootToken);
    expect(serialized).not.toMatch(/"token"\s*:/i);
  });
});
