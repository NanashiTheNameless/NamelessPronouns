import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('Chromium refuses unsafe SVG preview and offers explicit stripping', (t) => {
  const chromium = process.env.CHROMIUM_PATH || '/snap/bin/chromium';
  let html;
  try {
    html = execFileSync(chromium, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--allow-file-access-from-files', '--virtual-time-budget=1500', '--dump-dom',
      fileURLToPath(new URL('./fixtures/avatar-upload-harness.html', import.meta.url)),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('Chromium is not installed');
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
