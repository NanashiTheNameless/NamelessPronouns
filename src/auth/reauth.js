import db from '../db/index.js';
import { newId, newNumericCode } from '../util/ids.js';
import { keyedHash, safeEqual } from '../util/crypto.js';
export const REAUTH_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export function isFresh(session, { now = Date.now() } = {}) {
  if (!session || session.reauth_at == null) return false;
  return now - Number(session.reauth_at) <= REAUTH_TTL_MS;
}
export async function markFresh(sessionId, { now = Date.now() } = {}) {
  await db.query('UPDATE sessions SET reauth_at = ? WHERE id = ?', [now, sessionId]);
}
export function safeNextPath(next, fallback = '/settings') {
  if (typeof next !== 'string' || next.length === 0) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\\\x00-\x1f]/.test(next) || next.includes('://')) return fallback;
  return next;
}
export async function createEmailChallenge(userId, sessionId, { now = Date.now() } = {}) {
  await db.query('UPDATE reauth_challenges SET used = 1 WHERE session_id = ? AND used = 0', [sessionId]);
  const id = newId();
  const code = newNumericCode(6);
  await db.query(
    `INSERT INTO reauth_challenges (id, user_id, session_id, code_hash, attempts, used, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    [id, userId, sessionId, keyedHash(code), now + CODE_TTL_MS, now],
  );
  return { id, code };
}
async function getActiveEmailChallenge(sessionId, { now = Date.now() } = {}) {
  const { rows } = await db.query(
    `SELECT id, code_hash, attempts FROM reauth_challenges
       WHERE session_id = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    [sessionId, now],
  );
  return rows[0] || null;
}
export async function verifyEmailCode(sessionId, submitted, { now = Date.now() } = {}) {
  const challenge = await getActiveEmailChallenge(sessionId, { now });
  if (!challenge) return { ok: false, exhausted: false };
  const { rows } = await db.query(
    'UPDATE reauth_challenges SET attempts = attempts + 1 WHERE id = ? RETURNING attempts',
    [challenge.id],
  );
  const attempts = rows.length ? Number(rows[0].attempts) : MAX_ATTEMPTS;
  if (attempts > MAX_ATTEMPTS) {
    await db.query('UPDATE reauth_challenges SET used = 1 WHERE id = ?', [challenge.id]);
    return { ok: false, exhausted: true };
  }
  if (!safeEqual(keyedHash(String(submitted || '')), challenge.code_hash)) {
    return { ok: false, exhausted: false };
  }
  const consumed = await db.query(
    'UPDATE reauth_challenges SET used = 1 WHERE id = ? AND used = 0 RETURNING id',
    [challenge.id],
  );
  return { ok: consumed.rows.length > 0, exhausted: false };
}
