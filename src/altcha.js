import { randomInt } from 'node:crypto';
import { createChallenge as createAltchaChallenge, sha, verifySolution } from 'altcha/lib';
import config from './config.js';
import { hmac } from './util/crypto.js';
import { ipPrefixHash } from './util/net.js';
const ALGORITHM = 'SHA-256';
const MAX_NUMBER = config.ALTCHA_MAX_NUMBER;
const TTL_MS = 10 * 60 * 1000;
const MAX_TRACKED = 20000;
const used = new Map();
function sweep(now) {
  for (const [key, expiresAt] of used) {
    if (now >= expiresAt) used.delete(key);
  }
}
function claim(challenge, expiresAt, now) {
  const prior = used.get(challenge);
  if (prior !== undefined && now < prior) return false;
  if (used.size >= MAX_TRACKED) sweep(now);
  used.set(challenge, expiresAt);
  return true;
}
export function binding(req, endpoint) {
  const ua = String(req.headers['user-agent'] || '');
  return hmac(config.ALTCHA_HMAC_KEY, `${endpoint}|${ipPrefixHash(req) || ''}|${ua}`);
}
export async function createChallenge(req, endpoint, { now = Date.now() } = {}) {
  return createAltchaChallenge({
    algorithm: ALGORITHM,
    cost: 1,
    counter: randomInt(0, MAX_NUMBER + 1),
    deriveKey: sha.deriveKey,
    expiresAt: new Date(now + TTL_MS),
    hmacSignatureSecret: binding(req, endpoint),
  });
}
export async function verify(req, endpoint, payloadB64, { now = Date.now() } = {}) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(payloadB64), 'base64').toString('utf8'));
  } catch {
    return false;
  }
  const { challenge, solution } = payload || {};
  const { parameters, signature } = challenge || {};
  const { counter } = solution || {};
  if (parameters?.algorithm !== ALGORITHM || !signature || !Number.isInteger(counter)) return false;
  if (counter < 0 || counter > MAX_NUMBER) return false;
  const expiresAt = Number(parameters.expiresAt) * 1000;
  if (!expiresAt || now > expiresAt) return false;
  let result;
  try {
    result = await verifySolution({
      challenge,
      deriveKey: sha.deriveKey,
      hmacSignatureSecret: binding(req, endpoint),
      solution,
    });
  } catch {
    return false;
  }
  return result.verified && claim(signature, expiresAt, now);
}
export function _reset() {
  used.clear();
}
