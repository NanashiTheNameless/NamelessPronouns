import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../src/db/postgres.js';
import { splitStatements } from '../src/db/migrate.js';
import { newNumericCode, newToken } from '../src/util/ids.js';
import { keyedHash, safeEqual, encrypt, decrypt } from '../src/util/crypto.js';
import { signValue, unsignValue, signJson, unsignJson, sealJson, unsealJson } from '../src/util/cookies.js';
import { ipInCidr, ipToBigInt, ipPrefix } from '../src/util/net.js';
import * as V from '../src/validation.js';
import * as totp from '../src/auth/totp.js';
import { personalProfileStatements } from '../src/profiles.js';
import { TERMS_VERSION, PRIVACY_VERSION, buildAcceptance } from '../src/policy.js';
import { safeConsentReturn } from '../src/consent-return.js';
import config, { DEFAULT_EMAIL_DOMAIN_ALLOWLIST } from '../src/config.js';
import { matchesEmailDomain } from '../src/email-domains.js';
import { createD1Backend } from '../src/db/d1.js';
import { ownerBootstrapStatements } from '../src/owner-bootstrap.js';
test('rewrite: ? placeholders become $1..$n', () => {
  assert.equal(rewrite('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
});
test('rewrite: ignores ? inside single-quoted string literals', () => {
  assert.equal(rewrite("SELECT '?' , x WHERE y = ?"), "SELECT '?' , x WHERE y = $1");
});
test('splitStatements: drops comments and blanks, splits on ;', () => {
  const sql = `-- a comment\nCREATE TABLE a (id TEXT);\n\nCREATE TABLE b (id TEXT);`;
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE a (id TEXT)', 'CREATE TABLE b (id TEXT)']);
});
test('newNumericCode: correct length and zero-padded numeric', () => {
  for (let i = 0; i < 200; i++) {
    const code = newNumericCode(6);
    assert.match(code, /^[0-9]{6}$/);
  }
});
test('newToken: url-safe and unique', () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
test('keyedHash: deterministic and non-reversible-looking', () => {
  assert.equal(keyedHash('abc'), keyedHash('abc'));
  assert.notEqual(keyedHash('abc'), keyedHash('abd'));
  assert.match(keyedHash('abc'), /^[0-9a-f]{64}$/);
});
test('safeEqual: true only on exact match', () => {
  assert.ok(safeEqual('same', 'same'));
  assert.ok(!safeEqual('same', 'diff'));
  assert.ok(!safeEqual('short', 'longer'));
});
test('encrypt/decrypt: AES-256-GCM round trip', () => {
  const key = Buffer.alloc(32, 3);
  const { ciphertext, nonce } = encrypt(key, 'secret-value');
  assert.notEqual(ciphertext, 'secret-value');
  assert.equal(decrypt(key, ciphertext, nonce), 'secret-value');
});
test('decrypt: tampered ciphertext fails auth', () => {
  const key = Buffer.alloc(32, 3);
  const { ciphertext, nonce } = encrypt(key, 'secret-value');
  const bad = Buffer.from(ciphertext, 'base64');
  bad[0] ^= 0xff;
  assert.throws(() => decrypt(key, bad.toString('base64'), nonce));
});
test('cookies: signValue round trip and tamper rejection', () => {
  const secret = 'a'.repeat(32);
  const signed = signValue(secret, 'session-token');
  assert.equal(unsignValue(secret, signed), 'session-token');
  assert.equal(unsignValue(secret, `x${signed}`), null);
  assert.equal(unsignValue('b'.repeat(32), signed), null);
});
test('cookies: signJson round trip', () => {
  const secret = 'p'.repeat(32);
  const obj = { terms: '2026-08-07', age18: true, nonce: 'abc' };
  const signed = signJson(secret, obj);
  assert.deepEqual(unsignJson(secret, signed), obj);
  assert.equal(unsignJson(secret, `${signed}z`), null);
});
test('cookies: sealed JSON is confidential and tamper-evident', () => {
  const secret = 's'.repeat(32);
  const obj = { path: '/account/export/download/bearer-secret', expires_at: 1234 };
  const sealed = sealJson(secret, obj);
  assert.doesNotMatch(sealed, /bearer-secret/);
  assert.deepEqual(unsealJson(secret, sealed), obj);
  assert.equal(unsealJson(secret, `${sealed}x`), null);
  assert.equal(unsealJson('x'.repeat(32), sealed), null);
});
test('consent return accepts only root-relative same-origin paths', () => {
  assert.equal(safeConsentReturn('/account/export/download/token'), '/account/export/download/token');
  for (const hostile of [
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%2f%2fevil.example/path',
    '/%252f%252fevil.example/path',
    '/safe/../evil',
    '/safe?next=https://evil.example',
    '/safe#https://evil.example',
  ]) {
    assert.equal(safeConsentReturn(hostile), '/', hostile);
  }
});
test('email allowlist ships mainstream providers without enabling the policy', () => {
  for (const domain of ['namelessnanashi.dev', 'gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com', 'proton.me']) {
    assert.ok(DEFAULT_EMAIL_DOMAIN_ALLOWLIST.includes(domain));
    assert.ok(config.EMAIL_DOMAIN_ALLOWLIST.includes(domain));
  }
  assert.equal(config.EMAIL_DOMAIN_ALLOWLIST_ENABLED, false);
});
test('email domain rules match approved parent domains and their subdomains only', () => {
  const domains = new Set(['example.com']);
  assert.equal(matchesEmailDomain('example.com', domains), true);
  assert.equal(matchesEmailDomain('mail.example.com', domains), true);
  assert.equal(matchesEmailDomain('notexample.com', domains), false);
});
test('D1 batch sends each parameterized statement as a separate query', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      success: true,
      result: [
        { success: true, results: [], meta: { changes: 1 } },
        { success: true, results: [], meta: { changes: 1 } },
      ],
    }));
  };
  try {
    const results = await createD1Backend().batch([
      { sql: 'INSERT INTO users (id) VALUES (?)', params: ['user-id'] },
      { sql: 'INSERT INTO audit_events (id) VALUES (?)', params: ['event-id'] },
    ]);
    assert.deepEqual(request.body, {
      batch: [
        { sql: 'INSERT INTO users (id) VALUES (?)', params: ['user-id'] },
        { sql: 'INSERT INTO audit_events (id) VALUES (?)', params: ['event-id'] },
      ],
    });
    assert.match(request.url, /\/query$/);
    assert.deepEqual(results.map((result) => result.rowCount), [1, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('owner bootstrap preserves normalized and display usernames in every record', () => {
  const now = 123456;
  const { statements } = ownerBootstrapStatements({
    email: 'owner@example.com',
    passwordHash: 'hash',
    passwordHashVersion: 1,
    username: { key: 'namelessnanashi', display: 'NamelessNanashi' },
    now,
  });
  const user = statements.find((statement) => /INSERT INTO users/.test(statement.sql));
  const claim = statements.find((statement) => /INSERT INTO public_username_claims/.test(statement.sql));
  const profile = statements.find((statement) => /INSERT INTO profiles/.test(statement.sql));
  assert.match(user.sql, /requested_profile_username_display/);
  assert.deepEqual(user.params.slice(5, 8), ['namelessnanashi', 'NamelessNanashi', 'NamelessNanashi']);
  assert.match(claim.sql, /username, username_display/);
  assert.deepEqual(claim.params.slice(0, 2), ['namelessnanashi', 'NamelessNanashi']);
  assert.deepEqual(profile.params.slice(2, 5), ['namelessnanashi', 'NamelessNanashi', 'NamelessNanashi']);
});
test('net: ipInCidr IPv4 containment', () => {
  assert.ok(ipInCidr('203.0.113.42', '203.0.113.0', 24));
  assert.ok(!ipInCidr('203.0.114.1', '203.0.113.0', 24));
  assert.ok(ipInCidr('10.1.2.3', '10.0.0.0', 8));
});
test('net: ipInCidr IPv6 containment and family isolation', () => {
  assert.ok(ipInCidr('2001:db8::1', '2001:db8::', 32));
  assert.ok(!ipInCidr('2001:db9::1', '2001:db8::', 32));
  assert.ok(!ipInCidr('203.0.113.1', '2001:db8::', 32));
  assert.ok(ipToBigInt('::1').value === 1n);
});
test('net: ipPrefix coarsens addresses', () => {
  assert.equal(ipPrefix('203.0.113.42'), '203.0.113.0/24');
  assert.equal(ipPrefix('2001:db8:abcd:1::1'), '2001:db8:abcd::/48');
});
test('validation: displayText enforces ASCII boundary and collapses spaces', () => {
  assert.equal(V.displayText('  Alex   Quinn  ', { field: 'Name' }), 'Alex Quinn');
  assert.equal(V.displayText('Anne-Marie', { field: 'Name' }), 'Anne-Marie');
  assert.throws(() => V.displayText('naïve', { field: 'Name' }), V.ValidationError);
  assert.throws(() => V.displayText('hi<script>', { field: 'Name' }), V.ValidationError);
  assert.throws(() => V.displayText('', { field: 'Name' }), V.ValidationError);
  assert.throws(() => V.displayText('line\nbreak', { field: 'Name' }), V.ValidationError);
});
test('validation: proseText allows English punctuation but rejects fancy/special characters', () => {
  assert.equal(V.proseText("Hi! I'm Alex - (they/them). Nice to meet you.", { field: 'Bio' }), "Hi! I'm Alex - (they/them). Nice to meet you.");
  assert.equal(V.proseText('line one\n\nline two', { field: 'Bio' }), 'line one\n\nline two');
  assert.throws(() => V.proseText('𝓯𝓪𝓷𝓬𝔂', { field: 'Bio' }), V.ValidationError);
  assert.throws(() => V.proseText('emoji \u{1F600}', { field: 'Bio' }), V.ValidationError);
  assert.throws(() => V.proseText('zero​width', { field: 'Bio' }), V.ValidationError);
  assert.throws(() => V.proseText('fancy \u{1D4EF}', { field: 'Bio' }), V.ValidationError);
});
test('validation: signup reason accepts only 20 through 5000 characters', () => {
  const options = { field: 'Signup reason', min: 20, max: 5000 };
  assert.equal(V.reasonText('a'.repeat(20), options), 'a'.repeat(20));
  assert.equal(V.reasonText('a'.repeat(5000), options), 'a'.repeat(5000));
  assert.throws(() => V.reasonText('a'.repeat(19), options), V.ValidationError);
  assert.throws(() => V.reasonText('a'.repeat(5001), options), V.ValidationError);
});
test('validation: username rules and reserved names', () => {
  assert.deepEqual(V.username('Alex99'), { key: 'alex99', display: 'Alex99' });
  assert.deepEqual(V.username('  NamelessNanashi  '), { key: 'namelessnanashi', display: 'NamelessNanashi' });
  assert.deepEqual(V.username('has-dash'), { key: 'has-dash', display: 'has-dash' });
  assert.deepEqual(V.username('test-a-test2'), { key: 'test-a-test2', display: 'test-a-test2' });
  assert.deepEqual(V.username('a-b-c-d-e'), { key: 'a-b-c-d-e', display: 'a-b-c-d-e' });
  assert.throws(() => V.username('ab'), V.ValidationError);
  assert.throws(() => V.username('-lead'), V.ValidationError);
  assert.throws(() => V.username('trail-'), V.ValidationError);
  assert.throws(() => V.username('a--b'), V.ValidationError);
  assert.throws(() => V.username('Admin'), V.ValidationError);
  assert.throws(() => V.username('self'), V.ValidationError);
  assert.throws(() => V.username('root'), V.ValidationError);
});
test('validation: httpsUrl rejects non-HTTPS, credentials, and bad ports', () => {
  assert.equal(V.httpsUrl('https://example.com/x'), 'https://example.com/x');
  assert.throws(() => V.httpsUrl('http://example.com'), V.ValidationError);
  assert.throws(() => V.httpsUrl('javascript:alert(1)'), V.ValidationError);
  assert.throws(() => V.httpsUrl('https://user:pw@example.com'), V.ValidationError);
  assert.throws(() => V.httpsUrl('https://example.com:8080'), V.ValidationError);
});
test('totp: verify accepts current step and rejects replay/wrong', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const step = totp.currentStep(now);
  const code = totp.generate(secret, now);
  assert.equal(totp.verify(secret, code, { now }), step);
  assert.equal(totp.verify(secret, code, { now, lastUsedStep: step }), null);
  assert.equal(totp.verify(secret, code === '000000' ? '111111' : '000000', { now }), null);
});
test('personal profile creation uses content-safe generated display text', () => {
  const result = personalProfileStatements({
    userId: 'user-1', username: 'alex99', displayName: 'Alex 99', now: 123,
  });
  const workspaceInsert = result.statements[0];
  assert.equal(workspaceInsert.params[1], 'Alex 99 Workspace');
  assert.match(workspaceInsert.params[1], /^[A-Za-z0-9 ]+$/);
  assert.equal(result.statements.at(-1).params[1], 'alex99');
});
test('policy versions are source-controlled and included in acceptance records', () => {
  assert.equal(TERMS_VERSION, '2026-08-10.4');
  assert.equal(PRIVACY_VERSION, '2026-08-10.4');
  const acceptance = buildAcceptance({ now: 123 });
  assert.equal(acceptance.terms, TERMS_VERSION);
  assert.equal(acceptance.privacy, PRIVACY_VERSION);
});
