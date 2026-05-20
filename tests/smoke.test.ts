import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@solution-intelligence/identity scaffold', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBeTypeOf('string');
    expect(VERSION).toMatch(/^0\.1\.0-pre$/);
  });
});
