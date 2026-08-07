// Email+password auth for ProcurePro, mounted at /auth/* by app.ts.
//
// Registration is whitelist-gated: only an email an admin has already put on
// a users row (bomdb/scripts/set-user-email.ts) may create an account. On
// success both endpoints answer {token, name} where token is the user's
// EXISTING connector token — tokens live only in the TOKEN_MAP env, so we
// reverse-map the user's pg_role to the TOKEN_MAP entry whose database URL
// logs in as that role (pooler usernames are `<role>.<project-ref>`).
//
// These routes are the ONLY place bomdb-remote touches the MASTER connection
// (app_accounts is master-only; scoped roles can't read other users). The
// master engine must never be handed to the /mcp/:token path.
//
// No new dependencies: scrypt from node:crypto with a per-account random
// salt, constant-time compare via timingSafeEqual. Never log passwords,
// hashes, or tokens.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import type { Engine } from '../../bomdb/src/engine.ts';

const SCRYPT_KEYLEN = 64;
// Default node scrypt cost (N=16384, r=8, p=1) recorded in the hash so the
// parameters can be raised later without breaking existing accounts.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N, r, p, maxmem: 128 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N,r,p$<salt hex>$<key hex>` */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, r, p);
  return `scrypt$${N},${r},${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, params, saltHex, keyHex] = stored.split('$');
  if (algo !== 'scrypt' || !params || !saltHex || !keyHex) return false;
  const [N, r, p] = params.split(',').map(Number);
  if (![N, r, p].every(n => Number.isInteger(n) && n > 0)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), N, r, p);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The token whose TOKEN_MAP database URL logs in as this pg_role. Pooler
 * usernames are `<role>.<project-ref>`; direct/local ones are bare `<role>`.
 * The master connection is barred from TOKEN_MAP (see server.ts), so this
 * can only ever surface a scoped user token.
 */
export function tokenForRole(tokenMap: Record<string, string>, pgRole: string): string | null {
  for (const [token, url] of Object.entries(tokenMap)) {
    try {
      const username = decodeURIComponent(new URL(url).username);
      const role = username.includes('.') ? username.slice(0, username.indexOf('.')) : username;
      if (role === pgRole) return token;
    } catch { /* unparsable entry — skip */ }
  }
  return null;
}

export interface AuthOptions {
  /** Lazy MASTER engine (bypasses RLS; owns app_accounts). */
  master: () => Promise<Engine>;
  /** pg_role → that user's existing connector token, or null if unknown. */
  tokenForRole: (pgRole: string) => string | null;
}

// Small in-memory attempt counter per (ip, email) — enough to blunt online
// guessing on a single-instance service; resets on deploy, which is fine.
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

interface UserRow { id: string; name: string | null; pg_role: string | null; }

export function mountAuth(app: express.Express, opts: AuthOptions | null): void {
  if (!opts) {
    app.post(['/auth/register', '/auth/login'], (_req, res) => {
      res.status(503).json({ error: 'Password sign-in is not configured on this server.' });
    });
    return;
  }

  const attempts = new Map<string, { n: number; resetAt: number }>();
  function limited(key: string): boolean {
    const now = Date.now();
    if (attempts.size > 5000) { // prune stale windows so the map can't grow unbounded
      for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
    }
    const cur = attempts.get(key);
    if (!cur || cur.resetAt <= now) {
      attempts.set(key, { n: 1, resetAt: now + WINDOW_MS });
      return false;
    }
    cur.n += 1;
    return cur.n > MAX_ATTEMPTS;
  }

  /** Shared request vetting: parse body, rate-limit, normalize email. */
  function vet(req: express.Request, res: express.Response): { email: string; password: string } | null {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string'
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length === 0) {
      res.status(400).json({ error: 'Provide an email and a password.' });
      return null;
    }
    const norm = email.trim().toLowerCase();
    if (limited(`${req.ip ?? 'unknown'}|${norm}`)) {
      res.status(429).json({ error: 'Too many attempts — try again in a few minutes.' });
      return null;
    }
    return { email: norm, password };
  }

  app.post('/auth/register', async (req, res) => {
    const input = vet(req, res);
    if (!input) return;
    if (input.password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    try {
      const engine = await opts.master();
      const [user] = await engine.query<UserRow>(
        `SELECT id, name, pg_role FROM users WHERE lower(email) = $1`, [input.email]);
      if (!user) {
        res.status(403).json({ error: "This email isn't on the invite list." });
        return;
      }
      const existing = await engine.query(
        `SELECT 1 FROM app_accounts WHERE user_id = $1 OR email = $2`, [user.id, input.email]);
      if (existing.length > 0) {
        res.status(409).json({ error: 'An account already exists for this email — sign in instead.' });
        return;
      }
      const token = user.pg_role ? opts.tokenForRole(user.pg_role) : null;
      if (!token) {
        res.status(403).json({ error: "This account isn't fully provisioned yet — ask your admin to finish setup." });
        return;
      }
      const hash = await hashPassword(input.password);
      await engine.query(
        `INSERT INTO app_accounts (user_id, email, password_hash) VALUES ($1, $2, $3)`,
        [user.id, input.email, hash]);
      res.json({ token, name: user.name ?? input.email });
    } catch (err) {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        res.status(409).json({ error: 'An account already exists for this email — sign in instead.' });
        return;
      }
      console.error('register failed:', err instanceof Error ? err.message : 'unknown error');
      res.status(500).json({ error: 'Something went wrong — try again.' });
    }
  });

  app.post('/auth/login', async (req, res) => {
    const input = vet(req, res);
    if (!input) return;
    try {
      const engine = await opts.master();
      const [account] = await engine.query<{ password_hash: string; name: string | null; pg_role: string | null }>(
        `SELECT a.password_hash, u.name, u.pg_role
         FROM app_accounts a JOIN users u ON u.id = a.user_id
         WHERE a.email = $1`, [input.email]);
      // Same generic answer for unknown email vs wrong password; burn a hash
      // on the unknown-email path so the two are not timing-distinguishable.
      if (!account) {
        await hashPassword(input.password);
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }
      if (!(await verifyPassword(input.password, account.password_hash))) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }
      const token = account.pg_role ? opts.tokenForRole(account.pg_role) : null;
      if (!token) {
        res.status(403).json({ error: "This account isn't fully provisioned yet — ask your admin to finish setup." });
        return;
      }
      res.json({ token, name: account.name ?? input.email });
    } catch (err) {
      console.error('login failed:', err instanceof Error ? err.message : 'unknown error');
      res.status(500).json({ error: 'Something went wrong — try again.' });
    }
  });
}
