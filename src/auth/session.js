import db from '../db/index.js';
import config from '../config.js';
import { newToken } from '../util/ids.js';
import { keyedHash } from '../util/crypto.js';
import { signValue, unsignValue, cookieOptions } from '../util/cookies.js';
import { clientIp, ipPrefixHash } from '../util/net.js';
import { hmac } from '../util/crypto.js';
export const SESSION_COOKIE = 'np_sid';
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const IDLE_MS = 12 * 60 * 60 * 1000;
export const LAST_SEEN_WRITE_MS = 5 * 60 * 1000;
function uaHash(req) {
  return hmac(config.TOKEN_HASH_KEY, `ua:${req.headers['user-agent'] || ''}`);
}
export async function createSession(req, res, userId, { restricted = false, now = Date.now() } = {}) {
  const token = newToken(32);
  const id = keyedHash(token);
  const csrfToken = newToken(24);
  await db.query(
    `INSERT INTO sessions (id, user_id, csrf_token, ip_hash, user_agent_hash, restricted, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, csrfToken, ipPrefixHash(req), uaHash(req), restricted ? 1 : 0, now, now, now + ABSOLUTE_MS],
  );
  res.cookie(SESSION_COOKIE, signValue(config.COOKIE_SECRET, token), cookieOptions(ABSOLUTE_MS));
  return { id, csrfToken, restricted };
}
export async function destroyBySessionId(id, { now = Date.now() } = {}) {
  await db.query('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now, id]);
}
export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(0));
}
export async function rotateSession(req, res, userId, opts = {}) {
  const current = readSessionToken(req);
  if (current) await destroyBySessionId(keyedHash(current));
  return createSession(req, res, userId, opts);
}
export async function revokeAllForUser(userId, { now = Date.now() } = {}) {
  await db.query('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId]);
}
function readSessionToken(req) {
  const raw = req.cookies?.[SESSION_COOKIE];
  return raw ? unsignValue(config.COOKIE_SECRET, raw) : null;
}
export async function loadSession(req, { now = Date.now() } = {}) {
  const token = readSessionToken(req);
  if (!token) return null;
  const id = keyedHash(token);
  const { rows } = await db.query(
    'SELECT id, user_id, csrf_token, restricted, reauth_at, created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE id = ?',
    [id],
  );
  const session = rows[0];
  if (!session) return null;
  if (session.revoked_at != null) return null;
  if (Number(session.expires_at) <= now) return null;
  if (now - Number(session.last_seen_at) > IDLE_MS) {
    await destroyBySessionId(id, { now });
    return null;
  }
  if (now - Number(session.last_seen_at) >= LAST_SEEN_WRITE_MS) {
    await db.query('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, id]);
    session.last_seen_at = now;
  }
  session.restricted = Number(session.restricted) === 1;
  return session;
}
