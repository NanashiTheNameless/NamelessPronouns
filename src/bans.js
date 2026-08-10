import db from './db/index.js';
import config from './config.js';
import { hmac, encrypt } from './util/crypto.js';
import { ipInCidr, ipPrefix } from './util/net.js';
import { newId } from './util/ids.js';
import audit from './audit.js';
const TARGET_TYPES = ['user', 'email', 'domain', 'ip', 'cidr'];
const SENSITIVE = new Set(['email', 'ip', 'cidr']);
function normalize(type, value) {
  const v = String(value).trim().toLowerCase();
  if (type === 'domain') return v.replace(/^@/, '');
  return v;
}
export function targetHash(type, value) {
  return hmac(config.TOKEN_HASH_KEY, `ban:${type}:${normalize(type, value)}`);
}
function emailDomain(email) {
  const at = String(email).lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}
const activeClause = '(lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?))';
export function ipPrefixTargetHash(ip) {
  const prefix = ipPrefix(ip);
  return prefix ? targetHash('ip', prefix) : null;
}
export async function createBan({
  type, value, valueHash = null, scope, reason = null, createdBy = null, expiresAt = null,
}) {
  if (!TARGET_TYPES.includes(type)) throw new Error(`Invalid ban target type: ${type}`);
  if (!['account', 'viewing', 'both'].includes(scope)) throw new Error(`Invalid ban scope: ${scope}`);
  if (valueHash && !SENSITIVE.has(type)) throw new Error(`Hashed bans are not supported for ${type} targets.`);
  const now = Date.now();
  const id = newId();
  const normalized = valueHash ? valueHash : normalize(type, value);
  const hash = valueHash || targetHash(type, value);
  let ciphertext = null;
  let nonce = null;
  let plaintext = SENSITIVE.has(type) ? hash : normalized;
  let cidrNetwork = null;
  let cidrPrefix = null;
  if (SENSITIVE.has(type) && !valueHash && config.BAN_ENCRYPTION_KEY) {
    const enc = encrypt(config.BAN_ENCRYPTION_KEY, normalized);
    ciphertext = enc.ciphertext;
    nonce = enc.nonce;
  }
  if (type === 'cidr') {
    if (valueHash) throw new Error('CIDR bans require a plaintext network.');
    const [net, prefix] = normalized.split('/');
    cidrNetwork = net;
    cidrPrefix = Number(prefix);
    if (!Number.isInteger(cidrPrefix)) throw new Error('CIDR ban requires network/prefix');
  }
  await db.query(
    `INSERT INTO bans
       (id, target_type, target_value, target_hash, target_ciphertext, target_nonce,
        cidr_network, cidr_prefix, scope, reason, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, plaintext, hash, ciphertext, nonce, cidrNetwork, cidrPrefix, scope, reason, createdBy, now, expiresAt],
  );
  await audit.record({ type: 'ban.created', actorUserId: createdBy, target: `${type}:${hash.slice(0, 12)}`, detail: { scope } });
  return id;
}
async function matchExact({ scopes, userId, email, ip, now }) {
  const hashes = [];
  if (userId) hashes.push(targetHash('user', userId));
  if (email) {
    hashes.push(targetHash('email', email));
    hashes.push(targetHash('domain', emailDomain(email)));
  }
  if (ip) {
    hashes.push(targetHash('ip', ip));
    const prefixHash = ipPrefixTargetHash(ip);
    if (prefixHash) hashes.push(prefixHash);
  }
  if (hashes.length === 0) return null;
  const placeholders = hashes.map(() => '?').join(', ');
  const scopePlaceholders = scopes.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT id, target_type, scope FROM bans
      WHERE target_hash IN (${placeholders})
        AND scope IN (${scopePlaceholders})
        AND ${activeClause}
      LIMIT 1`,
    [...hashes, ...scopes, now],
  );
  return rows[0] || null;
}
async function matchCidr({ scopes, ip, now }) {
  if (!ip) return null;
  const scopePlaceholders = scopes.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT id, cidr_network, cidr_prefix FROM bans
      WHERE target_type = 'cidr' AND scope IN (${scopePlaceholders}) AND ${activeClause}`,
    [...scopes, now],
  );
  for (const row of rows) {
    if (ipInCidr(ip, row.cidr_network, row.cidr_prefix)) return { id: row.id, target_type: 'cidr' };
  }
  return null;
}
async function matchScope(scopes, ctx) {
  const now = Date.now();
  const exact = await matchExact({ scopes, ...ctx, now });
  if (exact) return exact;
  return matchCidr({ scopes, ip: ctx.ip, now });
}
export async function hasActiveBanForAccount({ userId, email, ipPrefixHash, now = Date.now() }) {
  const hashes = [];
  if (userId) hashes.push(targetHash('user', userId));
  if (email) {
    hashes.push(targetHash('email', email));
    hashes.push(targetHash('domain', emailDomain(email)));
  }
  if (ipPrefixHash) hashes.push(ipPrefixHash);
  if (!hashes.length) return false;
  const placeholders = hashes.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT id FROM bans WHERE target_hash IN (${placeholders}) AND ${activeClause} LIMIT 1`,
    [...hashes, now],
  );
  return rows.length > 0;
}
export function matchAccountBan(ctx) {
  return matchScope(['account', 'both'], ctx);
}
export function matchViewingBan(ctx) {
  return matchScope(['viewing', 'both'], ctx);
}
