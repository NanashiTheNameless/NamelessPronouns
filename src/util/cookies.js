import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.js';
import config from '../config.js';
function sign(secret, value) {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(value).digest('base64url');
}
export function signValue(secret, value) {
  return `${value}.${sign(secret, value)}`;
}
export function unsignValue(secret, signed) {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  return safeEqual(sig, sign(secret, value)) ? value : null;
}
export function signJson(secret, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return signValue(secret, body);
}
export function unsignJson(secret, signed) {
  const body = unsignValue(secret, signed);
  if (body == null) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
export function sealJson(secret, obj) {
  const key = createHash('sha256').update(String(secret)).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce, ciphertext, tag].map((part) => part.toString('base64url')).join('.');
}
export function unsealJson(secret, sealed) {
  if (typeof sealed !== 'string') return null;
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = createHash('sha256').update(String(secret)).digest();
    const [nonce, ciphertext, tag] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (nonce.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}
export function cookieOptions(maxAgeMs, extra = {}) {
  return {
    httpOnly: true,
    secure: config.SECURE_COOKIES,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
    ...extra,
  };
}
