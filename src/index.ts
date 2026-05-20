/**
 * @solution-intelligence/identity — public entry point
 *
 * // Why: This file is the only stable re-export surface for callers
 * // (other SI runtime packages, the CLI, tests). Internal modules are
 * // free to refactor; this set of exports is the v0.x contract.
 *
 * @requirement REQ-SI-NF-052 (JSDoc on exported symbols)
 */

export { VERSION } from './version.js';
export { startServer, buildApp } from './server.js';
export type { ServerHandle } from './server.js';
export type { Role, RoleGrant, ResolveResponse } from './types.js';
export { ROLES } from './types.js';
