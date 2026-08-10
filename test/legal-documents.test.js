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
  assert.doesNotMatch(termsText, /shared workspace/i);
  assert.doesNotMatch(privacyText, /shared workspace/i);
  assert.match(privacyText, /Cloudflare Web Analytics and RUM/i);
  assert.match(privacyText, /generated in memory on demand/i);
  assert.match(privacyText, /does not currently receive or store Resend webhook events/i);
  assert.doesNotMatch(privacyText, /export archives: 48 hours/i);
});
test('unknown legal document names are rejected', async () => {
  await assert.rejects(loadLegalDocument('unknown'));
});
