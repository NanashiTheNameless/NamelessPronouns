import { randomBytes } from 'node:crypto';
import config from './config.js';
import { signJson, unsignJson, cookieOptions } from './util/cookies.js';
export const POLICY_COOKIE = 'np_policy';
export const TERMS_VERSION = '2026-08-10.4';
export const PRIVACY_VERSION = '2026-08-10.4';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export function buildAcceptance({ now = Date.now() } = {}) {
  return {
    terms: TERMS_VERSION,
    privacy: PRIVACY_VERSION,
    age18: true,
    at: now,
    nonce: randomBytes(9).toString('base64url'),
  };
}
export function setAcceptanceCookie(res, acceptance) {
  res.cookie(POLICY_COOKIE, signJson(config.POLICY_COOKIE_SECRET, acceptance), cookieOptions(ONE_YEAR_MS));
}
export function readAcceptance(req, { now = Date.now() } = {}) {
  const raw = req.cookies?.[POLICY_COOKIE];
  if (!raw) return null;
  const data = unsignJson(config.POLICY_COOKIE_SECRET, raw);
  if (!data) return null;
  if (data.age18 !== true) return null;
  if (data.terms !== TERMS_VERSION || data.privacy !== PRIVACY_VERSION) return null;
  if (!data.at || now - Number(data.at) > ONE_YEAR_MS) return null;
  return data;
}
export function hasAccepted(req, opts) {
  return readAcceptance(req, opts) != null;
}
