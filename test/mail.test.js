import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminActionNeeded, outbox } from '../src/mail.js';
test('admin action notification uses configured recipient and safe fixed content', async () => {
  outbox.length = 0;
  await adminActionNeeded('content_flag', 'admin-content-test');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'Admin <admin@test.example.com>');
  assert.equal(outbox[0].subject, 'Admin action needed: content flag');
  assert.match(outbox[0].text, /https:\/\/test\.example\.com\/admin/);
  assert.match(outbox[0].text, /excludes sensitive case details/);
  assert.doesNotMatch(outbox[0].text, /attempted value|account email/i);
});
test('admin action notification rejects an unknown work category', () => {
  assert.throws(() => adminActionNeeded('arbitrary_detail', 'admin-unknown-test'));
});
