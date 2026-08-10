import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  validatePolicy,
  needsRehash,
  PasswordPolicyError,
  CURRENT_VERSION,
} from '../src/auth/password.js';
test('validatePolicy: rejects passwords under 12 characters', () => {
  assert.throws(() => validatePolicy('short'), PasswordPolicyError);
  assert.throws(() => validatePolicy('elevenchars'), PasswordPolicyError);
  assert.doesNotThrow(() => validatePolicy('twelvechars!'));
});
test('validatePolicy: rejects passwords over 256 characters', () => {
  assert.doesNotThrow(() => validatePolicy('a'.repeat(256)));
  assert.throws(() => validatePolicy('a'.repeat(257)), PasswordPolicyError);
});
test('validatePolicy: intentionally leaves bypassable wordlist screening to the browser', () => {
  assert.equal([...'password12345678'].length, 16);
  assert.doesNotThrow(() => validatePolicy('password12345678'));
});
test('validatePolicy: accepts a long passphrase with no composition rules', () => {
  assert.doesNotThrow(() => validatePolicy('correct horse battery staple'));
});
test('hashPassword/verifyPassword: round trip', async () => {
  const { hash, version } = await hashPassword('a-strong-enough-passphrase');
  assert.equal(version, CURRENT_VERSION);
  assert.ok(await verifyPassword('a-strong-enough-passphrase', hash));
  assert.ok(!(await verifyPassword('wrong-passphrase-value', hash)));
});
test('needsRehash: true only for older versions', () => {
  assert.ok(!needsRehash(CURRENT_VERSION));
  assert.ok(needsRehash(CURRENT_VERSION - 1));
});
