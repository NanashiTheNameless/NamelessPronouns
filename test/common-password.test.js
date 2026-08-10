import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'public/password-wordlists/manifest.json'), 'utf8'));
const index = readFileSync(path.join(root, 'public/password-wordlists/index.bin'));
function present(password, list) {
  const digest = createHash('sha256').update(password).digest();
  const h1 = digest.readBigUInt64BE(0);
  const h2 = digest.readBigUInt64BE(8) | 1n;
  for (let i = 0; i < manifest.hashCount; i += 1) {
    const bit = Number((h1 + BigInt(i) * h2) % BigInt(list.bitCount));
    if (!(index[list.offset + (bit >> 3)] & (1 << (bit & 7)))) return false;
  }
  return true;
}
async function firstEligible(file) {
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const newline = data.indexOf(10, start);
      if (newline < 0) break;
      let line = data.subarray(start, newline);
      if (line.at(-1) === 13) line = line.subarray(0, -1);
      const text = line.toString('utf8');
      if (Buffer.from(text).equals(line) && [...text].length >= 12 && [...text].length <= 256) return text;
      start = newline + 1;
    }
    carry = data.subarray(start);
  }
  return null;
}
test('static common-password index covers every configured source with eligible entries', async () => {
  const sourceNames = readdirSync(path.join(root, 'data/Known-Passwords'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(manifest.lists.map((list) => list.name), sourceNames);
  assert.equal(manifest.attribution, 'https://github.com/danielmiessler/SecLists');
  for (const list of manifest.lists) {
    const password = await firstEligible(path.join(root, 'data/Known-Passwords', list.name));
    if (list.count === 0) assert.equal(password, null, `${list.name} has no policy-eligible entries`);
    else assert.ok(password && present(password, list), `${list.name} has no false negative`);
  }
});
test('Chromium hard-blocks submission and cites the matching wordlist', async (t) => {
  const server = createServer((req, res) => {
    const files = {
      '/': 'test/fixtures/common-password-harness.html',
      '/static/js/common-password.js': 'public/js/common-password.js',
      '/static/password-wordlists/manifest.json': 'public/password-wordlists/manifest.json',
      '/static/password-wordlists/index.bin': 'public/password-wordlists/index.bin',
    };
    const relative = files[req.url];
    if (!relative) { res.writeHead(404).end(); return; }
    res.end(readFileSync(path.join(root, relative)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let stdout;
    try {
      ({ stdout } = await run(process.env.CHROMIUM_PATH || '/snap/bin/chromium', [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--virtual-time-budget=1500', '--dump-dom', `http://127.0.0.1:${server.address().port}/`,
      ], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }));
    } catch (error) {
      if (error.code === 'ENOENT') return t.skip('Chromium is not installed');
      throw error;
    }
    assert.match(stdout, /That password was found in a common password wordlist 100k-most-used-passwords-NCSC\.txt\. Choose another password\./);
    assert.match(stdout, /data-native-validation-message=""/);
    assert.match(stdout, /data-aria-invalid="true"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
