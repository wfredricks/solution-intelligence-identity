// Why: This is the v0.1.0-pre scaffold for @solution-intelligence/identity.
//      Product code will be added in build Stage 6 — a bangauth wrapper
//      enforcing SI's 5-role permission matrix (operator, analyst,
//      reviewer, consumer, admin) per REQ-SI-NF-031 and MODEL.md §3.
//      Until then, this module exports only its version so the toolchain
//      can be verified end to end.

/**
 * Package version.
 *
 * Why: Provides a single import-able symbol so Stage 1b's smoke test
 * has something real to assert against. Will be replaced with real
 * exports in Stage 6 (Identity provider, role guard, audit-aware
 * session middleware).
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */
export const VERSION = '0.1.0-pre';
