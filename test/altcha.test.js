import test from 'node:test';
import assert from 'node:assert/strict';
import { sha, solveChallenge } from 'altcha/lib';

const secret = (value) => `${value}${'x'.repeat(Math.max(0, 32 - value.length))}`;
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
  DATABASE_URL: 'postgres://u:p@localhost:5432/none',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Test <t@test.example.com>',
  ADMIN_NOTIFY_TO: 'Admin <admin@test.example.com>',
});

test('ALTCHA v3 challenge uses official creation and verification', async () => {
  const altcha = await import('../src/altcha.js');
  altcha._reset();
  const req = { headers: { 'user-agent': 'test-agent', 'cf-connecting-ip': '203.0.113.7' } };
  const challenge = await altcha.createChallenge(req, 'signup');
  assert.equal(challenge.parameters.algorithm, 'SHA-256');
  assert.ok(challenge.signature);
  assert.equal('maxnumber' in challenge, false, 'legacy v1 challenge fields are absent');

  const solution = await solveChallenge({ challenge, deriveKey: sha.deriveKey });
  assert.ok(solution, 'proof of work solved');
  const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');

  assert.equal(await altcha.verify(req, 'signup', payload), true, 'valid proof accepted');
  assert.equal(await altcha.verify(req, 'signup', payload), false, 'replay rejected');

  altcha._reset();
  const otherReq = { headers: { ...req.headers, 'user-agent': 'different-agent' } };
  assert.equal(await altcha.verify(otherReq, 'signup', payload), false, 'request-bound signature enforced');
  const tampered = Buffer.from(JSON.stringify({
    challenge: { ...challenge, signature: 'deadbeef' },
    solution,
  })).toString('base64');
  assert.equal(await altcha.verify(req, 'signup', tampered), false, 'bad signature rejected');
});
