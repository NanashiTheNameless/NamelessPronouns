import db from '../db/index.js';
import config from '../config.js';
import { newId, newToken, newNumericCode } from '../util/ids.js';
import { keyedHash, safeEqual } from '../util/crypto.js';
import { signJson, unsignJson, cookieOptions } from '../util/cookies.js';
export const PENDING_COOKIE = 'np_pending';
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export async function createEmailChallenge(userId, { now = Date.now() } = {}) {
  const id = newId();
  const code = newNumericCode(6);
  const magicToken = newToken(32);
  const binding = newToken(24);
  await db.query(
    `INSERT INTO login_challenges (id, user_id, method, code_hash, magic_token_hash, browser_binding_hash, attempts, used, expires_at, created_at)
     VALUES (?, ?, 'email', ?, ?, ?, 0, 0, ?, ?)`,
    [id, userId, keyedHash(code), keyedHash(magicToken), keyedHash(binding), now + CHALLENGE_TTL_MS, now],
  );
  return { id, code, magicToken, binding };
}
export async function createTotpChallenge(userId, { now = Date.now() } = {}) {
  const id = newId();
  await db.query(
    `INSERT INTO login_challenges (id, user_id, method, attempts, used, expires_at, created_at)
     VALUES (?, ?, 'totp', 0, 0, ?, ?)`,
    [id, userId, now + CHALLENGE_TTL_MS, now],
  );
  return { id };
}
export function setPendingCookie(res, { challengeId, binding, userId }) {
  const payload = signJson(config.COOKIE_SECRET, { cid: challengeId, b: binding, uid: userId });
  res.cookie(PENDING_COOKIE, payload, cookieOptions(CHALLENGE_TTL_MS));
}
export function readPending(req) {
  const raw = req.cookies?.[PENDING_COOKIE];
  return raw ? unsignJson(config.COOKIE_SECRET, raw) : null;
}
export function clearPendingCookie(res) {
  res.clearCookie(PENDING_COOKIE, cookieOptions(0));
}
export async function getActiveChallenge(id, { now = Date.now() } = {}) {
  const { rows } = await db.query(
    'SELECT id, user_id, method, code_hash, magic_token_hash, browser_binding_hash, attempts, used, expires_at FROM login_challenges WHERE id = ?',
    [id],
  );
  const c = rows[0];
  if (!c || Number(c.used) === 1 || Number(c.expires_at) <= now) return null;
  return c;
}
export async function consumeChallenge(id, { now = Date.now() } = {}) {
  const { rows } = await db.query(
    'UPDATE login_challenges SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ? RETURNING id',
    [id, now],
  );
  return rows.length > 0;
}
export async function bumpAttempts(id) {
  const { rows } = await db.query(
    'UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ? RETURNING attempts',
    [id],
  );
  return rows.length ? Number(rows[0].attempts) : MAX_ATTEMPTS;
}
export async function invalidateChallenge(id) {
  await db.query('UPDATE login_challenges SET used = 1 WHERE id = ?', [id]);
}
export { keyedHash, safeEqual };
