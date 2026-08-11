import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ChromiumMissing, dumpDom } from './helpers/chromium.js';
const root = fileURLToPath(new URL('..', import.meta.url));
test('rejected characters are named instead of "Please match the requested format"', async (t) => {
  const server = createServer((req, res) => {
    const files = {
      '/': 'test/fixtures/character-message-harness.html',
      '/static/js/profile-editor.js': 'public/js/profile-editor.js',
      '/static/js/field-messages.js': 'public/js/field-messages.js',
    };
    const file = files[req.url];
    if (!file) return res.writeHead(404).end();
    if (file.endsWith('.js')) res.setHeader('content-type', 'text/javascript');
    res.end(readFileSync(path.join(root, file)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let stdout;
    try {
      stdout = await dumpDom(['--virtual-time-budget=3000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`]);
    } catch (error) {
      if (error instanceof ChromiumMissing) return t.skip('Chromium is not installed');
      throw error;
    }
    const encoded = /<output id="browser-result">([^<]+)<\/output>/.exec(stdout)?.[1];
    assert.ok(encoded && encoded !== 'pending', 'the harness reported its validation messages');
    const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    assert.equal(
      result.notes,
      'Use only standard English letters, numbers, punctuation, and spaces. Remove this character: "Æ" (U+00C6).',
    );
    assert.equal(result.report, result.notes, 'the same text stays visible beside the field');
    assert.equal(result.notesInvalid, true);
    assert.equal(result.displayName, 'Use only letters, numbers, spaces, and dashes. Remove this character: "!" (U+0021).');
    assert.equal(result.linkUrl, 'Enter an HTTPS URL that starts with https://.');
    assert.equal(result.code, 'Enter the 6-digit code, digits only.');
    assert.equal(result.cleanValid, true, 'a valid value clears the custom message');
    for (const message of Object.values(result)) {
      if (typeof message === 'string') assert.doesNotMatch(message, /match the requested format/i);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
