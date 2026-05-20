/**
 * Adapted from bangauth — https://github.com/wfredricks/bangauth
 * Source commit: 3ae510649b2450c71099ab1e43d9350bc11d7087
 * Source path: src/server.ts (bangauth v0.1.1)
 *
 * Adapted for: SI/I identity service, v0.2.0-pre (Stage 2a).
 * Maintenance ownership: SI core team. See ARCHETYPE.md for refresh policy.
 *
 * Modifications from upstream (HEAVY — this file diverges substantially from
 * upstream and is documented diff-by-diff below):
 *   - File now exports a Hono Router (`authRouter`) plus a small accessor for
 *     the shared key store. It is no longer a top-level server. The top-level
 *     SI/I server lives in `src/server.ts` and mounts this router under
 *     `/auth`.
 *   - MFA routes (`/auth/mfa/enroll`, `/auth/mfa/verify`) dropped — deferred
 *     to SI/I v0.2. Source MFA files preserved under `_deferred/`.
 *   - Recovery and login-page routes dropped — deferred to v0.2.
 *   - HTML login-page (`GET /auth/login`) dropped — SI/I v0.1 is CLI-only.
 *   - NATS publisher dropped — SI uses chainblocks audit, not NATS, for event
 *     emission. See `src/audit.ts` for the SI side.
 *   - `twin-id.ts` import + the `twinId` field on the verify-code response
 *     dropped — twinId is bangauth-specific (UDT concept). SI's response
 *     shape is `{ authenticated, email, token }`.
 *   - All `BANGAUTH_*` env vars renamed to `SI_*`. `BANGAUTH_APP_ID` is now
 *     `SI_PROJECT_ID` (semantic rename per ARCHETYPE.md).
 *   - User-facing "BangAuth" strings replaced with "Solution Intelligence".
 *   - Top-level `console.log` boot banner and SIGINT/SIGTERM handlers moved
 *     into `src/server.ts` (the composing server). This file now has zero
 *     side effects at import time.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes } from 'node:crypto';
import { ConsoleEmailAdapter } from './adapters/email-console.js';
import { MemoryKeyStore } from './adapters/keys-memory.js';
import { MemoryUserStore } from './adapters/users-memory.js';
import { isDomainAllowed } from './domain.js';
import { generateToken, currentMonth } from './token.js';
import type { KeyStore } from './types.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface AuthConfig {
  /** Human-readable application name shown in emails and logs. */
  appName: string;
  /**
   * Project id embedded in every issued token (the field formerly called
   * `constellationId` in bangauth). Renamed for SI per ARCHETYPE.md.
   */
  projectId: string;
  /** Allow-listed email domains (supports `*`, `*.tld`, `*sub*` patterns). */
  allowedDomains: string[];
  /** Base URL used for any links emitted by the email adapter. */
  loginUrl: string;
  /** Support mailbox shown in rejection emails. */
  supportEmail: string;
}

/**
 * Load configuration from environment variables.
 *
 * // Why: SI/I v0.1 is env-var driven for parity with bangauth's container
 * // mode. Real config (SSM/Secrets Manager) lives in `_deferred/config.ts`
 * // and arrives in v0.2 when the AWS dependency is acceptable.
 */
export function loadAuthConfig(): AuthConfig {
  return {
    appName: process.env.SI_APP_NAME ?? 'Solution Intelligence',
    projectId: process.env.SI_PROJECT_ID ?? 'si-default',
    allowedDomains: (process.env.SI_ALLOWED_DOMAINS ?? '*')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
    loginUrl: process.env.SI_LOGIN_URL ?? 'http://localhost:3001/auth/login',
    supportEmail: process.env.SI_SUPPORT_EMAIL ?? '',
  };
}

// ─── Lazy Singletons ─────────────────────────────────────────────────────────

// Why: Lazy so env vars set after import time (notably in vitest beforeAll
// blocks) are honored on first use. Without this, importing `auth/server.ts`
// at file top would freeze SI_PROJECT_ID / SI_APP_NAME / etc. to the values
// present when the module was first loaded. Singleton semantics are
// preserved by caching the first construction.

let _config: AuthConfig | null = null;
let _emailAdapter: ConsoleEmailAdapter | null = null;
let _keyStore: KeyStore | null = null;
let _userStore: MemoryUserStore | null = null;
let _cleanupInterval: NodeJS.Timeout | null = null;

function config(): AuthConfig {
  if (!_config) _config = loadAuthConfig();
  return _config;
}

function emailAdapter(): ConsoleEmailAdapter {
  if (!_emailAdapter) _emailAdapter = new ConsoleEmailAdapter();
  return _emailAdapter;
}

function keyStore(): KeyStore {
  if (!_keyStore) _keyStore = new MemoryKeyStore();
  return _keyStore;
}

function userStore(): MemoryUserStore {
  if (!_userStore) {
    _userStore = new MemoryUserStore();
    // Why: Cleanup interval is co-installed with the user store so it only
    // starts after the first real use; unref'd so it doesn't keep tests alive.
    _cleanupInterval = setInterval(() => {
      _userStore?.cleanupExpiredCodes();
    }, 60_000);
    _cleanupInterval.unref?.();
  }
  return _userStore;
}

/**
 * Accessor for the auth module's shared key store.
 *
 * // Why: `src/resolve.ts` needs to verify tokens issued by `/auth`. It calls
 * // this accessor so verification uses the same in-memory keys. If we later
 * // swap MemoryKeyStore for an SSM-backed store, this accessor is the seam.
 */
export function getAuthKeyStore(): KeyStore {
  return keyStore();
}

/** Accessor for the auth config (for use by composers/tests). */
export function getAuthConfig(): AuthConfig {
  return config();
}

/**
 * Test-only: reset the lazy singletons so a subsequent call re-reads env vars
 * and constructs fresh state. Production code must not call this.
 */
export function _resetAuthSingletonsForTests(): void {
  if (_cleanupInterval) clearInterval(_cleanupInterval);
  _config = null;
  _emailAdapter = null;
  _keyStore = null;
  _userStore = null;
  _cleanupInterval = null;
}

// ─── Hono Router ─────────────────────────────────────────────────────────────

/**
 * Hono router for the `/auth` subtree.
 *
 * // Why: Exported as a router (not a server) so the top-level SI/I server
 * // can mount it alongside `/resolve` and `/grants`.
 */
export const authRouter = new Hono();

authRouter.use('*', cors());

// ─── POST /auth/request-code ─────────────────────────────────────────────────

/**
 * Request an access code via email.
 *
 * Body: { email: string }
 * Response: { status: 'sent' } | { error: string }
 */
authRouter.post('/request-code', async (c) => {
  try {
    const body = await c.req.json<{ email?: string }>();
    const email = body.email?.toLowerCase().trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'Invalid email address' }, 400);
    }

    const cfg = config();
    if (!isDomainAllowed(email, cfg.allowedDomains)) {
      // Why: Send a polite rejection email (printed to console in dev) so the
      // user has a paper trail of what to ask for.
      await emailAdapter().sendRejectionEmail({
        to: email,
        fromAddress: 'noreply@si.local',
        fromName: cfg.appName,
        constellationName: cfg.appName,
        supportEmail: cfg.supportEmail,
      });
      return c.json({ error: 'Email domain not authorized' }, 403);
    }

    // Why: In non-production, use a fixed dev code for fast iteration. In
    // production, derive a random 6-digit code from crypto bytes.
    const devMode = process.env.NODE_ENV !== 'production' || process.env.SI_DEV_CODE;
    const code = devMode
      ? process.env.SI_DEV_CODE ?? '123456'
      : String(parseInt(randomBytes(3).toString('hex'), 16) % 1_000_000).padStart(6, '0');

    await userStore().storeAccessCode(email, code, 5 * 60 * 1000); // 5 min TTL

    await emailAdapter().sendTokenEmail({
      to: email,
      // Why: For passwordless flow, we email the human-typeable CODE (not the
      // long HMAC token). The user pastes the code into `/auth/verify-code`
      // which then issues the long token.
      token: code,
      constellationName: cfg.appName,
      loginUrl: cfg.loginUrl,
      validThrough: 'end of session',
      fromAddress: 'noreply@si.local',
      fromName: cfg.appName,
    });

    return c.json({ status: 'sent', message: 'Check your email for the access code' });
  } catch (err) {
    console.error('request-code error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ─── POST /auth/verify-code ──────────────────────────────────────────────────

/**
 * Verify an access code and issue a long-form SI access token.
 *
 * Body: { email: string, code: string }
 * Response: { authenticated: true, email, token } | { authenticated: false, error }
 *
 * // Why: SI's response intentionally omits `twinId` (a bangauth concept) and
 * // `mfaRequired` (deferred to v0.2). Callers receive a single `token` they
 * // hand to `/resolve` to obtain roles.
 */
authRouter.post('/verify-code', async (c) => {
  try {
    const body = await c.req.json<{ email?: string; code?: string }>();
    const email = body.email?.toLowerCase().trim();
    const code = body.code?.trim();

    if (!email || !code) {
      return c.json({ authenticated: false, error: 'Email and code are required' }, 400);
    }

    const valid = await userStore().verifyAccessCode(email, code);
    if (!valid) {
      return c.json({ authenticated: false, error: 'Invalid or expired code' }, 401);
    }

    const key = await keyStore().getCurrentKey();
    const month = currentMonth();
    const token = generateToken(email, month, key, config().projectId);

    return c.json({ authenticated: true, email, token });
  } catch (err) {
    console.error('verify-code error:', err);
    return c.json({ authenticated: false, error: 'Internal server error' }, 500);
  }
});

// ─── GET /auth/.well-known/jwks.json ─────────────────────────────────────────

/**
 * Public key metadata for downstream services that want to verify tokens
 * locally.
 *
 * // Why: SI/S and SI/W can choose between calling `/resolve` (which does the
 * // verification for them) or fetching this endpoint to cache key metadata.
 * // For HS256 we cannot expose the secret, so consumers that want local
 * // verification must call `/resolve`. Kept for forward-compat with HS-asym
 * // algorithm support in v0.2+.
 */
authRouter.get('/.well-known/jwks.json', async (c) => {
  try {
    const activeKeys = await keyStore().listActiveKeys();
    const keys = activeKeys.map((k) => ({
      kid: k.kid,
      alg: k.alg,
      use: 'sig',
      expiresAt: k.expiresAt,
    }));
    return c.json({ keys });
  } catch (err) {
    console.error('jwks error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});
