/**
 * Package version.
 *
 * // Why: Re-exported from `src/index.ts` so importers have a stable single
 * // symbol to assert against (smoke test, /health endpoint, audit payloads).
 * // Bumped from 0.1.0-pre → 0.2.0-pre at the Stage 2a checkpoint.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.2.0-pre';
