import { createHmac, randomBytes } from 'node:crypto';
import config from '../config.js';
import db from '../db/index.js';
const PERIOD = 30;
const DIGITS = 6;
const SKEW = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function generateSecret(bytes = 20) {
  const buf = randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}
function base32Decode(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 secret');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmacDigest = createHmac('sha1', key).update(buf).digest();
  const offset = hmacDigest[hmacDigest.length - 1] & 0x0f;
  const code =
    ((hmacDigest[offset] & 0x7f) << 24) |
    ((hmacDigest[offset + 1] & 0xff) << 16) |
    ((hmacDigest[offset + 2] & 0xff) << 8) |
    (hmacDigest[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}
export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD);
}
export function generate(secret, now = Date.now()) {
  return hotp(secret, currentStep(now));
}
export function verify(secret, token, { now = Date.now(), lastUsedStep = null } = {}) {
  if (!/^\d{6}$/.test(String(token || ''))) return null;
  const step = currentStep(now);
  for (let offset = -SKEW; offset <= SKEW; offset++) {
    const candidate = step + offset;
    if (lastUsedStep != null && candidate <= lastUsedStep) continue;
    if (hotp(secret, candidate) === String(token)) return candidate;
  }
  return null;
}
export async function recordStep(userId, step) {
  const { rows } = await db.query(
    `UPDATE users SET totp_last_step = ?, updated_at = ?
      WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)
      RETURNING id`,
    [step, Date.now(), userId, step],
  );
  return rows.length > 0;
}
export function otpauthUrl(secret, accountLabel) {
  const issuer = encodeURIComponent(new URL(config.BASE_URL).host || 'NamelessPronouns');
  const label = encodeURIComponent(accountLabel);
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}
