import { createHash } from 'node:crypto';
import config from './config.js';
import db from './db/index.js';
import { hmac, keyedHash, safeEqual } from './util/crypto.js';
import { ipPrefixHash } from './util/net.js';
import { newId } from './util/ids.js';
const ALGORITHM = 'SHA-256';
const MAX_NUMBER = config.ALTCHA_MAX_NUMBER;
const TTL_MS = 10 * 60 * 1000;
function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}
export function binding(req, endpoint) {
  const ua = String(req.headers['user-agent'] || '');
  return hmac(config.ALTCHA_HMAC_KEY, `${endpoint}|${ipPrefixHash(req) || ''}|${ua}`);
}
function signature(challenge, bind, expires) {
  return hmac(config.ALTCHA_HMAC_KEY, `${challenge}|${bind}|${expires}`);
}
export function createChallenge(req, endpoint, { now = Date.now() } = {}) {
  const expires = now + TTL_MS;
  const secretNumber = Math.floor(Math.random() * (MAX_NUMBER + 1));
  const salt = `${newId().replace(/-/g, '')}?expires=${expires}`;
  const challenge = sha256Hex(salt + secretNumber);
  const bind = binding(req, endpoint);
  return {
    algorithm: ALGORITHM,
    challenge,
    salt,
    signature: signature(challenge, bind, expires),
    maxnumber: MAX_NUMBER,
  };
}
function parseExpires(salt) {
  const m = /[?&]expires=(\d+)/.exec(salt || '');
  return m ? Number(m[1]) : 0;
}
export async function verify(req, endpoint, payloadB64, { now = Date.now() } = {}) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(payloadB64), 'base64').toString('utf8'));
  } catch {
    return false;
  }
  const { algorithm, challenge, number, salt, signature: sig } = payload || {};
  if (algorithm !== ALGORITHM || !challenge || !salt || typeof number !== 'number' || !sig) return false;
  if (number < 0 || number > MAX_NUMBER || !Number.isInteger(number)) return false;
  const expires = parseExpires(salt);
  if (!expires || now > expires) return false;
  const bind = binding(req, endpoint);
  if (!safeEqual(sig, signature(challenge, bind, expires))) return false;
  if (!safeEqual(challenge, sha256Hex(salt + number))) return false;
  const { rows } = await db.query(
    `INSERT INTO altcha_challenges (id, challenge_hash, binding_hash, used, expires_at, created_at)
       VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT (challenge_hash) DO NOTHING
     RETURNING id`,
    [newId(), keyedHash(challenge), keyedHash(bind), expires, now],
  );
  return rows.length > 0;
}
