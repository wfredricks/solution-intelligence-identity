/**
 * SI/I — Stage 2a smoke test.
 *
 * // Why: The Stage 1b smoke (VERSION import) is preserved, then extended to
 * // confirm the server entry boots and shuts down cleanly. Anything beyond
 * // boot/shutdown belongs in dedicated tests.
 */

import { describe, it, expect } from 'vitest';
import { VERSION, startServer } from '../src/index.js';

describe('@solution-intelligence/identity', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^0\.2\.2-pre$/);
  });

  it('startServer + close lifecycle works on port 0', async () => {
    const handle = await startServer(0);
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
  });
});
