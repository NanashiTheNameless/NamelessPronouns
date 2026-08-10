import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import config from '../config.js';
const KEY = Buffer.from(config.TOKEN_HASH_KEY, 'utf8');
export function keyedHash(value) {
  return createHmac('sha256', KEY).update(String(value)).digest('hex');
}
export function hmac(secret, value) {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(String(value)).digest('hex');
}
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
export function encrypt(key, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}
export function decrypt(key, ciphertextB64, nonceB64) {
  const raw = Buffer.from(ciphertextB64, 'base64');
  const enc = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceB64, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
