import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLegalDocument, parseLegalMarkdown } from '../src/legal-documents.js';
test('legal parser produces structured blocks without generating HTML', () => {
  const document = parseLegalMarkdown(`# Test\n\n## Section\n\nText <script>alert 1</script>.\n\n- One\n- Two\n  continued`);
  assert.equal(document.title, 'Test');
  assert.deepEqual(document.blocks, [
    { type: 'heading', level: 2, text: 'Section' },
    { type: 'paragraph', text: 'Text <script>alert 1</script>.' },
    { type: 'list', items: ['One', 'Two continued'] },
  ]);
  assert.equal(document.blocks.some((block) => Object.hasOwn(block, 'html')), false);
});
test('canonical Terms and Privacy documents load completely', async () => {
  const terms = await loadLegalDocument('terms');
  const privacy = await loadLegalDocument('privacy');
  assert.equal(terms.title, 'Terms of Service');
  assert.equal(privacy.title, 'Privacy Policy');
  assert.ok(terms.blocks.length > 20);
  assert.ok(privacy.blocks.length > 25);
  const termsText = terms.blocks.map((block) => block.text || block.items?.join(' ')).join(' ');
  const privacyText = privacy.blocks.map((block) => block.text || block.items?.join(' ')).join(' ');
  assert.match(termsText, /judge-signed judicial warrants/i);
  assert.match(termsText, /reusable.*14 days.*seven days/i);
  assert.match(termsText, /restricted SVG/i);
  assert.match(termsText, /collaborative profile management is not offered/i);
  assert.doesNotMatch(termsText, /workspace/i, 'the Terms speak only of accounts and profiles');
  assert.doesNotMatch(privacyText, /workspace/i, 'the Privacy Policy speaks only of accounts and profiles');
  assert.match(termsText, /may create more/i, 'the Terms describe more than one profile per account');
  assert.match(termsText, /reserved to that account for seven days/i);
  assert.match(termsText, /primary profile cannot be deleted/i, 'the Terms explain the primary profile');
  assert.match(termsText, /cannot move the role themselves: ask support/i, 'the Terms say who moves the primary role');
  assert.match(termsText, /release it early/i, 'the Terms explain releasing a held username');
  assert.match(termsText, /absence of a badge is not a statement/i, 'the Terms are honest about hidden staff badges');
  assert.match(privacyText, /removed from the page before the page is sent/i, 'the Policy explains how a badge is hidden');
  assert.match(privacyText, /whether it is that account's primary profile/i);
  assert.match(privacyText, /Username claims, including a username held for seven days/i);
  assert.match(privacyText, /Cloudflare Web Analytics and RUM/i);
  assert.match(privacyText, /generated in memory on demand/i);
  assert.match(privacyText, /does not currently receive or store Resend webhook events/i);
  assert.doesNotMatch(privacyText, /export archives: 48 hours/i);
});
test('unknown legal document names are rejected', async () => {
  await assert.rejects(loadLegalDocument('unknown'));
});
