import config from './config.js';
import { cookieOptions, sealJson, unsealJson } from './util/cookies.js';
export const CONSENT_RETURN_COOKIE = 'np_consent_return';
const RETURN_TTL_MS = 10 * 60 * 1000;
export function safeConsentReturn(input, fallback = '/') {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//')) return fallback;
  if (input.includes('\\') || input.includes('..') || /[?#\u0000-\u001f\u007f]/.test(input)) return fallback;
  if (input.includes('%')) return fallback;
  return input;
}
export function setConsentReturn(res, path, { now = Date.now() } = {}) {
  const safe = safeConsentReturn(path, null);
  if (!safe) return false;
  res.cookie(
    CONSENT_RETURN_COOKIE,
    sealJson(config.POLICY_COOKIE_SECRET, { path: safe, expires_at: now + RETURN_TTL_MS }),
    cookieOptions(RETURN_TTL_MS),
  );
  return true;
}
export function readConsentReturn(req, { now = Date.now() } = {}) {
  const value = unsealJson(config.POLICY_COOKIE_SECRET, req.cookies?.[CONSENT_RETURN_COOKIE]);
  if (!value || Number(value.expires_at) <= now) return null;
  return safeConsentReturn(value.path, null);
}
export function clearConsentReturn(res) {
  const { maxAge, ...options } = cookieOptions(0);
  res.clearCookie(CONSENT_RETURN_COOKIE, options);
}
