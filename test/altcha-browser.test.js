import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ChromiumMissing, dumpDom } from './helpers/chromium.js';
const root = fileURLToPath(new URL('..', import.meta.url));
test('ALTCHA uses the NamelessUnSee business settings and solves in Chromium', async (t) => {
  const server = createServer((req, res) => {
    const files = {
      '/': 'test/fixtures/altcha-widget-harness.html',
      '/static/css/main.css': 'public/css/main.css',
      '/static/vendor/altcha/widget.js': 'node_modules/altcha/dist/main/altcha.min.js',
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
      stdout = await dumpDom(['--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`]);
    } catch (error) {
      if (error instanceof ChromiumMissing) return t.skip('Chromium is not installed');
      throw error;
    }
    const encoded = /<output id="browser-result">([^<]+)<\/output>/.exec(stdout)?.[1];
    assert.ok(encoded && encoded !== 'pending', 'widget completed proof-of-work');
    const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.deepEqual(result, { solved: true, theme: 'business', logoVisible: false, footerVisible: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
