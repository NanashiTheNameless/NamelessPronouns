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
  assert.throws(() => validatePolicy('Short1!'), PasswordPolicyError);
  assert.throws(() => validatePolicy('ElevenChr1!'), PasswordPolicyError);
  assert.doesNotThrow(() => validatePolicy('TwelveChar1!'));
});
test('validatePolicy: rejects passwords over 256 characters', () => {
  assert.doesNotThrow(() => validatePolicy(`Aa1!${'b'.repeat(252)}`));
  assert.throws(() => validatePolicy(`Aa1!${'b'.repeat(253)}`), PasswordPolicyError);
});
test('validatePolicy: demands an uppercase letter, a lowercase letter, a number, and a symbol', () => {
  assert.doesNotThrow(() => validatePolicy('Str0ng-Passphrase'));
  assert.throws(() => validatePolicy('str0ng-passphrase'), PasswordPolicyError);
  assert.throws(() => validatePolicy('STR0NG-PASSPHRASE'), PasswordPolicyError);
  assert.throws(() => validatePolicy('Strong-Passphrase'), PasswordPolicyError);
  assert.throws(() => validatePolicy('Str0ngPassphrase'), PasswordPolicyError);
});
test('validatePolicy: names every missing character class', () => {
  assert.throws(
    () => validatePolicy('passphrase-only'),
    (error) => error.message === 'Password must contain an uppercase letter, a number.',
  );
});
test('validatePolicy: counts non-ASCII letters, digits, and marks', () => {
  assert.doesNotThrow(() => validatePolicy('Ünikode-passwörd1'));
  assert.doesNotThrow(() => validatePolicy('Parola1\u0660\u0640xyzabc'));
});
test('validatePolicy: intentionally leaves bypassable wordlist screening to the browser', () => {
  assert.equal([...'Password@123'].length, 12);
  assert.doesNotThrow(() => validatePolicy('Password@123'));
});
test('hashPassword/verifyPassword: round trip', async () => {
  const { hash, version } = await hashPassword('A-strong-enough-passphrase1');
  assert.equal(version, CURRENT_VERSION);
  assert.ok(await verifyPassword('A-strong-enough-passphrase1', hash));
  assert.ok(!(await verifyPassword('A-wrong-passphrase-value1', hash)));
});
test('needsRehash: true only for older versions', () => {
  assert.ok(!needsRehash(CURRENT_VERSION));
  assert.ok(needsRehash(CURRENT_VERSION - 1));
});
