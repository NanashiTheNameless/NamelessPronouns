import test from 'node:test';
import assert from 'node:assert/strict';
import { obfuscateEmail, obfuscateEmails } from '../src/email-obfuscation.js';
test('ALTCHA email widgets contain no plaintext address', async () => {
  const email = 'Person+test@example.invalid';
  const widget = await obfuscateEmail(email);
  assert.match(widget, /^<altcha-widget/);
  assert.match(widget, /data-obfuscated="[^"]+"/);
  assert.match(widget, /display="invisible"/);
  assert.match(widget, />click to reveal<\/button>/);
  assert.doesNotMatch(widget, /Person|example\.invalid|mailto:/i);
});
test('email prose is escaped while addresses become ALTCHA widgets', async () => {
  const html = await obfuscateEmails('<strong>Contact Person@example.invalid now.</strong>');
  assert.match(html, /^&lt;strong&gt;Contact <altcha-widget/);
  assert.match(html, /now\.&lt;\/strong&gt;$/);
  assert.doesNotMatch(html, /Person@example\.invalid/);
});
test('invalid addresses are rejected by the exact-address helper', async () => {
  await assert.rejects(obfuscateEmail('not-an-email'), /invalid email/i);
});
