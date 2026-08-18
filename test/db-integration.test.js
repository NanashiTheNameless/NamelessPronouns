import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const DB_URL = process.env.NP_TEST_DATABASE_URL;
const secret = (s) => `${s}${'x'.repeat(Math.max(0, 32 - s.length))}`;
Object.assign(process.env, {
  NODE_ENV: 'test',
  BASE_URL: 'https://test.example.com',
  COOKIE_SECRET: secret('cookie-secret-'),
  POLICY_COOKIE_SECRET: secret('policy-secret-'),
  TOKEN_HASH_KEY: secret('token-hash-key-'),
  ALTCHA_HMAC_KEY: secret('altcha-hmac-key-'),
  ALTCHA_MAX_NUMBER: '4000',
  PASSWORD_PEPPER: '',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CONTENT_FLAG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DB_BACKEND: 'postgres',
  DATABASE_URL: DB_URL || 'postgres://u:p@localhost:5432/none',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Test <t@test.example.com>',
  ADMIN_NOTIFY_TO: 'Admin <admin@test.example.com>',
});
const skip = !DB_URL;
after(async () => {
  if (skip) return;
  const db = (await import('../src/db/index.js')).default;
  await db.close().catch(() => {});
});
test('rate limiter: consume increments and blocks past the limit', { skip }, async () => {
  const { consume, POLICIES } = await import('../src/ratelimit.js');
  const db = (await import('../src/db/index.js')).default;
  const subject = `test-${Date.now()}-${Math.random()}`;
  const max = POLICIES.signup.max;
  let last;
  for (let i = 0; i < max; i++) {
    last = await consume('signup', subject);
    assert.equal(last.allowed, true, `attempt ${i + 1} within limit`);
  }
  last = await consume('signup', subject);
  assert.equal(last.allowed, false, 'attempt over limit blocked');
  assert.equal(last.count, max + 1);
});
test('altcha: issued challenge verifies once, replay rejected', { skip }, async () => {
  const altcha = await import('../src/altcha.js');
  const { sha, solveChallenge } = await import('altcha/lib');
  const db = (await import('../src/db/index.js')).default;
  const req = { headers: { 'user-agent': 'test-agent', 'cf-connecting-ip': '203.0.113.7' } };
  const endpoint = 'signup';
  const challenge = await altcha.createChallenge(req, endpoint);
  const solution = await solveChallenge({ challenge, deriveKey: sha.deriveKey });
  assert.ok(solution, 'proof of work solved');
  const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
  assert.equal(await altcha.verify(req, endpoint, payload), true, 'valid proof accepted');
  assert.equal(await altcha.verify(req, endpoint, payload), false, 'replay rejected');
  const tampered = Buffer.from(JSON.stringify({ challenge: { ...challenge, signature: 'deadbeef' }, solution })).toString('base64');
  assert.equal(await altcha.verify(req, endpoint, tampered), false, 'bad signature rejected');
});
test('bans: exact email, domain, and CIDR matching by scope', { skip }, async () => {
  const bans = await import('../src/bans.js');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `blocked-${suffix}@banned-${suffix}.example`;
  const domain = `banned-${suffix}.example`;
  await bans.createBan({ type: 'email', value: email, scope: 'account' });
  await bans.createBan({ type: 'cidr', value: '198.51.100.0/24', scope: 'viewing' });
  assert.ok(await bans.matchAccountBan({ email }), 'account ban matches banned email');
  assert.equal(await bans.matchAccountBan({ email: `ok-${suffix}@allowed.example` }), null, 'unrelated email not banned');
  await bans.createBan({ type: 'domain', value: domain, scope: 'both' });
  assert.ok(await bans.matchAccountBan({ email: `someoneelse@${domain}` }), 'domain ban matches any local part');
  assert.ok(await bans.matchViewingBan({ ip: '198.51.100.77' }), 'ip inside banned CIDR blocked from viewing');
  assert.equal(await bans.matchViewingBan({ ip: '198.51.101.1' }), null, 'ip outside CIDR allowed');
  assert.equal(await bans.matchAccountBan({ ip: '198.51.100.77' }), null, 'viewing ban does not affect account scope');
});
test('denied signups are purged after a week unless banned or held', { skip }, async () => {
  const { purgeDeniedSignups, DENIED_RETENTION_MS } = await import('../src/maintenance.js');
  const bans = await import('../src/bans.js');
  const db = (await import('../src/db/index.js')).default;
  const { newId } = await import('../src/util/ids.js');
  const now = Date.now();
  const stale = now - DENIED_RETENTION_MS - 1000;
  const suffix = `${now}${Math.floor(Math.random() * 1000)}`;
  const make = async (label, decidedAt) => {
    const id = newId();
    const email = `denied-${label}-${suffix}@denied-${suffix}.example`;
    await db.query(
      `INSERT INTO users (id, email, password_hash, signup_status, decided_at, created_at, updated_at)
       VALUES (?, ?, 'x', 'denied', ?, ?, ?)`,
      [id, email, decidedAt, now, now],
    );
    return { id, email };
  };
  const expired = await make('expired', stale);
  const fresh = await make('fresh', now - 1000);
  const banned = await make('banned', stale);
  await bans.createBan({ type: 'email', value: banned.email, scope: 'account' });
  const summary = await purgeDeniedSignups(now);
  assert.ok(summary.denied_signups_purged >= 1, 'the week-old request was purged');
  assert.ok(summary.denied_signups_retained >= 1, 'the banned request was retained');
  const survivors = await db.query(
    'SELECT id FROM users WHERE id IN (?, ?, ?)',
    [expired.id, fresh.id, banned.id],
  );
  const ids = survivors.rows.map((row) => row.id);
  assert.ok(!ids.includes(expired.id), 'the expired denial is gone, freeing the email to re-request');
  assert.ok(ids.includes(fresh.id), 'a recent denial is kept until the week is up');
  assert.ok(ids.includes(banned.id), 'a banned applicant is kept so the ban keeps its subject');
  await db.query('DELETE FROM users WHERE id IN (?, ?)', [fresh.id, banned.id]);
});
test('bans: a keyed signup IP-range hash blocks the whole range without storing the address', { skip }, async () => {
  const bans = await import('../src/bans.js');
  const db = (await import('../src/db/index.js')).default;
  const stored = bans.ipPrefixTargetHash('203.0.113.42');
  assert.ok(stored, 'a signup records a bannable IP-range hash');
  assert.equal(stored, bans.ipPrefixTargetHash('203.0.113.9'), 'the hash covers the whole /24');
  await bans.createBan({ type: 'ip', valueHash: stored, scope: 'account' });
  assert.ok(await bans.matchAccountBan({ ip: '203.0.113.7' }), 'another address in the range is banned');
  assert.equal(await bans.matchAccountBan({ ip: '203.0.114.7' }), null, 'a neighbouring range is unaffected');
  const { rows } = await db.query('SELECT target_value, target_ciphertext FROM bans WHERE target_hash = ?', [stored]);
  assert.equal(rows[0].target_value, stored, 'only the keyed hash is stored');
  assert.equal(rows[0].target_ciphertext, null, 'there is no recoverable address to encrypt');
});
