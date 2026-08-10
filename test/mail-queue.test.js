import './setup.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as mail from '../src/mail.js';
beforeEach(() => {
  mail._resetMailState();
  mail.outbox.length = 0;
});
test('non-critical mail is capped at the bucket and overflow is queued', async () => {
  const to = 'bucket@test.example';
  for (let i = 0; i < 10; i++) {
    const r = await mail.securityNotice(to, `notice ${i}`);
    assert.equal(r.id, 'test-outbox');
  }
  assert.equal(mail.outbox.length, 10);
  const over = await mail.securityNotice(to, 'notice 10');
  assert.equal(over.id, 'queued');
  assert.equal(mail.outbox.length, 10);
  assert.equal(mail.queueDepth(), 1);
  let res = await mail.drainMailQueue({ now: Date.now() });
  assert.equal(res.sent, 0);
  assert.equal(mail.queueDepth(), 1);
  res = await mail.drainMailQueue({ now: Date.now() + 60_000 });
  assert.equal(res.sent, 1);
  assert.equal(mail.queueDepth(), 0);
  assert.equal(mail.outbox.length, 11);
});
test('critical mail bypasses the bucket even when it is empty', async () => {
  const to = 'critical@test.example';
  for (let i = 0; i < 10; i++) await mail.securityNotice(to, `n${i}`);
  assert.equal(mail.outbox.length, 10);
  const r = await mail.twofaEmail(to, '123456', 'https://test.example.com/x', 'k1');
  assert.equal(r.id, 'test-outbox');
  assert.equal(mail.outbox.length, 11);
  assert.equal(mail.queueDepth(), 0);
});
test('code warnings appear only in emails that contain authentication codes', async () => {
  await mail.securityNotice('notice@test.example', 'A new sign-in was completed.');
  assert.doesNotMatch(mail.outbox[0].text, /ask for this code|never share/i);
  assert.doesNotMatch(mail.outbox[0].text, /Time:/);
  assert.match(mail.outbox[0].text, /https:\/\/test\.example\.com\/contact/);

  await mail.twofaEmail('code@test.example', '123456', 'https://test.example.com/login', 'code-warning');
  assert.match(mail.outbox[1].text, /staff will never ask for this code/i);
  assert.match(mail.outbox[1].text, /do not share it with anyone/i);
});
test('buckets are independent per recipient', async () => {
  for (let i = 0; i < 10; i++) await mail.securityNotice('a@test.example', `a${i}`);
  const other = await mail.securityNotice('b@test.example', 'b0');
  assert.equal(other.id, 'test-outbox');
  assert.equal(mail.queueDepth(), 0);
});
test('a bucket that refills to full is evicted to save memory', async () => {
  const to = 'evict@test.example';
  for (let i = 0; i < 10; i++) await mail.securityNotice(to, `n${i}`);
  assert.equal(mail._bucketCount(), 1, 'a depleted bucket is retained');
  await mail.drainMailQueue({ now: Date.now() + 10 * 60_000 });
  assert.equal(mail._bucketCount(), 0, 'the refilled bucket is evicted');
});
