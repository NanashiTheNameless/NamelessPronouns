import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ChromiumMissing, dumpDom } from './helpers/chromium.js';
test('Chromium refuses unsafe SVG preview and offers explicit stripping', async (t) => {
  let html;
  try {
    html = await dumpDom([
      '--allow-file-access-from-files', '--virtual-time-budget=1500', '--dump-dom',
      fileURLToPath(new URL('./fixtures/avatar-upload-harness.html', import.meta.url)),
    ]);
  } catch (error) {
    if (error instanceof ChromiumMissing) return t.skip('Chromium is not installed');
    throw error;
  }
  const encoded = /<output id="browser-result">([^<]+)<\/output>/.exec(html)?.[1];
  assert.ok(encoded && encoded !== 'pending', 'browser harness completed');
  const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  result.decoded = result.decoded.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'");
  assert.match(result.before.warning, /will not be previewed or saved/i);
  assert.match(result.before.refused, /Preview refused/i);
  assert.equal(result.before.stripOffered, true);
  assert.equal(result.before.preview, 'data:image/svg+xml,initial-identicon');
  assert.equal(result.before.value, '');
  assert.deepEqual(result.before.mutations, [], 'preview src never changed before confirmation');
  assert.match(result.afterUri, /^data:image\/svg\+xml;base64,/);
  assert.match(result.decoded, /<circle/);
  assert.doesNotMatch(result.decoded, /script|alert/i);
});
