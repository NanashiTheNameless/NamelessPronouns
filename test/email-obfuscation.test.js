import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deobfuscate } from 'altcha-lib/obfuscation';
import { obfuscateEmail, obfuscateEmails } from '../src/email-obfuscation.js';
test('ALTCHA email widgets contain no plaintext address', async () => {
  const email = 'Person+test@example.invalid';
  const widget = await obfuscateEmail(email);
  assert.match(widget, /^<altcha-widget/);
  assert.match(widget, /data-obfuscated="[^"]+"/);
  assert.match(widget, /display="floating"/);
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

test('a reader can decrypt the widget payload back to the address', async () => {
  const widget = await obfuscateEmail('reveal-target@example.invalid');
  const payload = /data-obfuscated="([^"]+)"/.exec(widget)[1];
  const started = performance.now();
  const revealed = await deobfuscate(payload);
  const elapsed = performance.now() - started;
  assert.equal(revealed, 'mailto:reveal-target@example.invalid');
  assert.ok(elapsed < 2500, `revealing took ${elapsed.toFixed(0)}ms, too slow for a click`);
});
test('addresses are revealed on demand rather than on page load', async () => {
  const script = readFileSync(fileURLToPath(new URL('../public/js/email-obfuscation.js', import.meta.url)), 'utf8');
  assert.match(script, /obfuscation\.js/, 'the plugin registers before the widget upgrades');
  assert.match(script, /widget\.js/);
  assert.doesNotMatch(script, /\.click\(\)/, 'nothing auto-reveals addresses');
  assert.ok(script.indexOf('obfuscation.js') < script.indexOf('widget.js'), 'plugin loads first');
});
