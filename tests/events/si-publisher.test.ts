/**
 * Unit tests for `src/events/si-publisher.ts`.
 *
 * Verifies the SI-specific wrapper around the events-spine Publisher:
 *   - Correct subject names (`si.identity.login.completed`,
 *     `.grant.recorded`, `.revoke.recorded`)
 *   - Correct payload shapes (no token, no login code — events-spine C5)
 *   - Graceful no-op when the underlying Publisher cannot connect
 *   - Idempotent close
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Publisher } from '../../src/events/publisher/index.js';
import {
  createSiIdentityPublisher,
  SI_IDENTITY_PUBLISHER_ID,
  SI_IDENTITY_SUBJECTS,
} from '../../src/events/si-publisher.js';

interface RecordedPublish {
  subject: string;
  payload: Record<string, unknown>;
  publisherId?: string;
  correlationId?: string;
}

/**
 * Build a fake Publisher that records every publish in a shared array.
 * The `connectShouldFail` flag drives the "NATS unreachable" branch.
 */
function makeFakeUnderlying(opts: { connectShouldFail?: boolean; publishShouldThrow?: boolean } = {}) {
  const recorded: RecordedPublish[] = [];
  let closed = false;
  let connected = false;
  const underlying: Publisher = {
    async connect() {
      if (opts.connectShouldFail) {
        throw new Error('fake: connect refused');
      }
      connected = true;
    },
    publish(input) {
      if (!connected) {
        throw new Error('fake: connect() must be awaited before publish()');
      }
      if (opts.publishShouldThrow) {
        throw new Error('fake: publish failed');
      }
      recorded.push({
        subject: input.subject,
        payload: input.payload,
        publisherId: input.publisherId,
        correlationId: input.correlationId,
      });
    },
    publishPayload() {
      throw new Error('not used by si-publisher');
    },
    async close() {
      closed = true;
    },
  };
  return {
    underlying,
    recorded,
    isClosed: () => closed,
  };
}

/** Capture logger calls so tests can assert on graceful-no-op behavior. */
function makeCapturingLogger() {
  const warns: Array<{ message: string; meta?: unknown }> = [];
  return {
    logger: {
      warn(message: string, meta?: unknown) {
        warns.push({ message, meta });
      },
    },
    warns,
  };
}

describe('createSiIdentityPublisher', () => {
  let fake: ReturnType<typeof makeFakeUnderlying>;
  let logCap: ReturnType<typeof makeCapturingLogger>;

  beforeEach(() => {
    fake = makeFakeUnderlying();
    logCap = makeCapturingLogger();
  });

  it('emits the canonical login.completed subject and payload', async () => {
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    pub.publishLoginCompleted({ email: 'alice@x.com', projectId: 'p-test' });

    expect(fake.recorded).toHaveLength(1);
    const ev = fake.recorded[0];
    expect(ev.subject).toBe(SI_IDENTITY_SUBJECTS.loginCompleted);
    expect(ev.subject).toBe('si.identity.login.completed');
    expect(ev.payload).toEqual({ email: 'alice@x.com', projectId: 'p-test' });
    expect(ev.publisherId).toBe(SI_IDENTITY_PUBLISHER_ID);
  });

  it('emits grant.recorded with subject/principal/action/resource + auditBlockSeq', async () => {
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    pub.publishGrantRecorded({
      actor: 'root@x.com',
      projectId: 'p-test',
      targetUserId: 'alice@x.com',
      role: 'Operator',
      auditBlockSeq: 42,
    });

    expect(fake.recorded).toHaveLength(1);
    expect(fake.recorded[0].subject).toBe('si.identity.grant.recorded');
    expect(fake.recorded[0].payload).toEqual({
      actor: 'root@x.com',
      projectId: 'p-test',
      targetUserId: 'alice@x.com',
      role: 'Operator',
      auditBlockSeq: 42,
    });
  });

  it('emits revoke.recorded symmetric to grant', async () => {
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    pub.publishRevokeRecorded({
      actor: 'root@x.com',
      projectId: 'p-test',
      targetUserId: 'alice@x.com',
      role: 'Operator',
      auditBlockSeq: 43,
    });

    expect(fake.recorded[0].subject).toBe('si.identity.revoke.recorded');
    expect(fake.recorded[0].payload.role).toBe('Operator');
  });

  it('forwards correlationId when supplied', async () => {
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    pub.publishLoginCompleted(
      { email: 'alice@x.com', projectId: 'p-test' },
      'req-abc',
    );

    expect(fake.recorded[0].correlationId).toBe('req-abc');
  });

  it('NEVER includes a token, code, or password field in any payload (C5)', async () => {
    // Why: events-spine constraint C5 forbids credentials in event
    // payloads. We assert on the type surface AND on a runtime
    // serialization check: every payload, when stringified, must not
    // mention `token`, `password`, `code`, or `secret` as a key.
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    pub.publishLoginCompleted({ email: 'alice@x.com', projectId: 'p-test' });
    pub.publishGrantRecorded({
      actor: 'root@x.com',
      projectId: 'p-test',
      targetUserId: 'alice@x.com',
      role: 'Operator',
      auditBlockSeq: 1,
    });
    pub.publishRevokeRecorded({
      actor: 'root@x.com',
      projectId: 'p-test',
      targetUserId: 'alice@x.com',
      role: 'Operator',
      auditBlockSeq: 2,
    });

    for (const ev of fake.recorded) {
      const serialized = JSON.stringify(ev.payload);
      expect(serialized).not.toMatch(/"token"\s*:/i);
      expect(serialized).not.toMatch(/"password"\s*:/i);
      expect(serialized).not.toMatch(/"secret"\s*:/i);
      expect(serialized).not.toMatch(/"code"\s*:/i);
      expect(serialized).not.toMatch(/"accessCode"\s*:/i);
    }
  });

  it('gracefully no-ops when underlying connect() rejects', async () => {
    const fakeBad = makeFakeUnderlying({ connectShouldFail: true });
    const pub = createSiIdentityPublisher({
      underlying: fakeBad.underlying,
      logger: logCap.logger,
    });

    await pub.connect(); // must NOT throw

    pub.publishLoginCompleted({ email: 'alice@x.com', projectId: 'p-test' });

    expect(fakeBad.recorded).toHaveLength(0);
    // Should have warned about both connect failure and the skipped publish.
    const messages = logCap.warns.map((w) => w.message);
    expect(messages.some((m) => m.includes('connect failed'))).toBe(true);
    expect(messages.some((m) => m.includes('publish skipped'))).toBe(true);
  });

  it('gracefully no-ops when underlying publish() throws', async () => {
    const fakeBad = makeFakeUnderlying({ publishShouldThrow: true });
    const pub = createSiIdentityPublisher({
      underlying: fakeBad.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    // Why: must not throw — graceful no-op contract.
    expect(() =>
      pub.publishLoginCompleted({ email: 'a@b.com', projectId: 'p' }),
    ).not.toThrow();

    const messages = logCap.warns.map((w) => w.message);
    expect(messages.some((m) => m.includes('publish threw'))).toBe(true);
  });

  it('close() is idempotent and skips publishes after close', async () => {
    const pub = createSiIdentityPublisher({
      underlying: fake.underlying,
      logger: logCap.logger,
    });
    await pub.connect();

    await pub.close();
    await pub.close(); // idempotent

    pub.publishLoginCompleted({ email: 'a@b.com', projectId: 'p' });
    expect(fake.recorded).toHaveLength(0);
    expect(fake.isClosed()).toBe(true);
  });
});
