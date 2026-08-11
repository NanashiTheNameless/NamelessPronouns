import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TERMS_VERSION, PRIVACY_VERSION } from '../src/policy.js';
const terms = () => readFile(new URL('../docs/legal/TERMS.md', import.meta.url), 'utf8');
const privacy = () => readFile(new URL('../docs/legal/PRIVACY.md', import.meta.url), 'utf8');
test('the Terms describe the Markdown that profile prose actually accepts', async () => {
  const text = await terms();
  assert.match(text, /limited set of Markdown\s+formatting/);
  assert.match(text, /Administrator and Owner accounts may also use\s+hyperlinks/);
  assert.match(text, /Hyperlinks written inside About me or Identity notes are limited to\s+Administrator and Owner accounts/);
  assert.match(text, /HTML tags are shown as text instead\s+of being interpreted/);
  assert.doesNotMatch(
    text,
    /do not allow user HTML, Markdown, JavaScript/,
    'the blanket ban on Markdown is gone now that Markdown is supported',
  );
});
test('both documents say who can open an unpublished profile', async () => {
  const termsText = await terms();
  assert.match(termsText, /An unpublished profile is not shown to the public/);
  assert.match(termsText, /the account that owns that profile/);
  assert.match(termsText, /authorized staff acting on moderation/);
  assert.match(termsText, /Being signed in to some other account\s+grants nothing here/);
  assert.match(termsText, /you cannot\s+open anyone else's/);
  const privacyText = await privacy();
  assert.match(privacyText, /A signed-in account can reach only its own unpublished profile and\s+never another account's/);
  assert.match(privacyText, /from a different account or from a\s+signed-out browser alike/);
  assert.match(await privacy(), /An unpublished profile is not public[\s\S]*?owns it and by authorized staff/);
  assert.match(await terms(), /Staff may review reports, public profiles, and unpublished profile pages/);
});
test('the Privacy Policy covers the accessibility settings kept in the browser', async () => {
  const text = await privacy();
  assert.match(text, /## 5\. Cookies and local storage/);
  assert.match(text, /Accessibility panel in the site footer stores the theme you pick/);
  assert.match(text, /never sent\s+to the server/);
  assert.match(text, /are not included in an account\s+export/);
  assert.match(text, /Accessibility settings in local storage: kept in that browser/);
  assert.match(text, /addresses taken from Markdown links written in\s+profile prose/);
});
test('both documents say that every page asks not to be indexed', async () => {
  assert.match(await terms(), /Every page of the service is sent with instructions asking search engines\s+not to index or archive it/);
  assert.match(await privacy(), /Every page of the service, published profiles included,\s+is sent with instructions asking search engines not to index, archive, snippet,\s+or follow it/);
  assert.match(await privacy(), /Those instructions are voluntary/);
});
test('the accepted policy versions moved past the pre-Markdown release', async () => {
  assert.equal(TERMS_VERSION, PRIVACY_VERSION, 'both documents are accepted as one version pair');
  assert.notEqual(TERMS_VERSION, '2026-08-10.1', 'a material change requires renewed acceptance');
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  for (const document of [await terms(), await privacy()]) {
    assert.match(document, /^Effective date: \w+ \d{1,2}, \d{4}$/m);
  }
});
