import { randomBytes } from 'node:crypto';
import config from './config.js';
import db from './db/index.js';
import { newId } from './util/ids.js';
import { signJson, unsignJson, cookieOptions } from './util/cookies.js';
export const POLICY_COOKIE = 'np_policy';
export const TERMS_VERSION = '2026-08-14.1';
export const PRIVACY_VERSION = '2026-08-14.1';
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
export function acceptanceStatements({ userId, ipHash = null, now = Date.now() }) {
  return [{
    sql: `INSERT INTO policy_acceptances
            (id, user_id, terms_version, privacy_version, age_18_attested_at, accepted_at, keyed_ip_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [newId(), userId, TERMS_VERSION, PRIVACY_VERSION, now, now, ipHash],
  }];
}
const STORED_ACCEPTANCE_LIMIT = 10000;
const storedAcceptances = new Set();
function storedAcceptanceKey(userId) {
  return `${userId}:${TERMS_VERSION}:${PRIVACY_VERSION}`;
}
function rememberStoredAcceptance(userId) {
  if (storedAcceptances.size >= STORED_ACCEPTANCE_LIMIT) storedAcceptances.clear();
  storedAcceptances.add(storedAcceptanceKey(userId));
}
export async function hasStoredAcceptance(userId) {
  if (!userId) return false;
  if (storedAcceptances.has(storedAcceptanceKey(userId))) return true;
  const { rows } = await db.query(
    'SELECT id FROM policy_acceptances WHERE user_id = ? AND terms_version = ? AND privacy_version = ? LIMIT 1',
    [userId, TERMS_VERSION, PRIVACY_VERSION],
  );
  if (!rows[0]) return false;
  rememberStoredAcceptance(userId);
  return true;
}
export async function recordAcceptance({ userId, ipHash = null, now = Date.now() }) {
  if (!userId) return false;
  if (await hasStoredAcceptance(userId)) return false;
  await db.batch(acceptanceStatements({ userId, ipHash, now }));
  rememberStoredAcceptance(userId);
  return true;
}
