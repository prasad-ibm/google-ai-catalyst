'use strict';

/**
 * Authentication module for Google AI Catalyst.
 *
 * - Credentials are stored in Postgres (`users` table).
 * - Passwords are hashed with Node's built-in scrypt (no native deps).
 * - Sessions are signed, HMAC-protected cookies stored in Postgres
 *   (`sessions` table) so they survive restarts and are revocable.
 *
 * No third-party auth packages are required — everything uses the Node
 * standard library `crypto` module, which sidesteps the mounted-FS npm
 * install issues in this environment.
 */

const crypto = require('crypto');
const { query } = require('./db');

const SESSION_COOKIE = 'gaic_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
// Secret used to sign session ids. Overridable via env for production.
const SESSION_SECRET = process.env.SESSION_SECRET || 'gaic-dev-secret-change-me';

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt)                                                   */
/* -------------------------------------------------------------------------- */

/** Hash a plaintext password → "salt:derivedKey" (both hex). */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${dk}`;
}

/** Constant-time verify a plaintext password against a stored "salt:dk". */
function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, dk] = stored.split(':');
  const dkBuf = Buffer.from(dk, 'hex');
  const testBuf = crypto.scryptSync(String(plain), salt, 64);
  if (dkBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(dkBuf, testBuf);
}

/* -------------------------------------------------------------------------- */
/* Session id signing                                                          */
/* -------------------------------------------------------------------------- */

function signSid(sid) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('hex');
  return `${sid}.${sig}`;
}

function unsignSid(signed) {
  if (!signed || typeof signed !== 'string' || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const sid = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? sid : null;
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers                                                              */
/* -------------------------------------------------------------------------- */

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function setSessionCookie(res, signed, maxAgeMs) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* -------------------------------------------------------------------------- */
/* Schema (users + sessions)                                                   */
/* -------------------------------------------------------------------------- */

async function ensureAuthSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username     text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      last_login   timestamptz
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid        text PRIMARY KEY,
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username   text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `);
}

/** Insert the user if absent; update the password if it already exists. */
async function seedUser(username, plainPassword) {
  const hash = hashPassword(plainPassword);
  await query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username)
     DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, hash]
  );
}

/* -------------------------------------------------------------------------- */
/* Session store ops                                                           */
/* -------------------------------------------------------------------------- */

async function createSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (sid, user_id, username, expires_at) VALUES ($1, $2, $3, $4)`,
    [sid, user.id, user.username, expiresAt]
  );
  return sid;
}

async function getSession(sid) {
  const r = await query(
    `SELECT sid, user_id, username, expires_at FROM sessions WHERE sid = $1`,
    [sid]
  );
  if (!r.rows.length) return null;
  const s = r.rows[0];
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await destroySession(sid);
    return null;
  }
  return s;
}

async function destroySession(sid) {
  await query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
}

/* -------------------------------------------------------------------------- */
/* Auth flows                                                                  */
/* -------------------------------------------------------------------------- */

async function login(username, password) {
  const r = await query(`SELECT id, username, password_hash FROM users WHERE username = $1`, [username]);
  if (!r.rows.length) return null;
  const user = r.rows[0];
  if (!verifyPassword(password, user.password_hash)) return null;
  await query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
  const sid = await createSession(user);
  return { user: { id: user.id, username: user.username }, sid };
}

/**
 * Middleware: reads the signed session cookie, validates it against the
 * Postgres sessions table, and attaches req.user if valid.
 */
function sessionMiddleware() {
  return async (req, res, next) => {
    req.user = null;
    try {
      const cookies = parseCookies(req);
      const signed = cookies[SESSION_COOKIE];
      const sid = unsignSid(signed);
      if (sid) {
        const s = await getSession(sid);
        if (s) req.user = { id: s.user_id, username: s.username, sid };
      }
    } catch (_) { /* unauthenticated */ }
    next();
  };
}

/** Guard for JSON API routes → 401 if not logged in. */
function requireAuthApi(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'authentication required' });
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  signSid,
  unsignSid,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  ensureAuthSchema,
  seedUser,
  createSession,
  getSession,
  destroySession,
  login,
  sessionMiddleware,
  requireAuthApi,
};
