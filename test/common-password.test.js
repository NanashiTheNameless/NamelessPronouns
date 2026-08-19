import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromiumMissing, dumpMatching } from './helpers/chromium.js';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const INDEX_VERSION = 3;
const REBUILD = 'Run: yarn build-password-index';
const COMPOSITION = [/\p{Lu}/u, /\p{Ll}/u, /\p{Nd}/u, /[^\p{Lu}\p{Ll}\p{Nd}]/u];
function loadIndex() {
  try {
    return {
      manifest: JSON.parse(readFileSync(path.join(root, 'public/password-wordlists/manifest.json'), 'utf8')),
      index: readFileSync(path.join(root, 'public/password-wordlists/index.bin')),
    };
  } catch {
    return { manifest: null, index: null };
  }
}
const { manifest, index } = loadIndex();
const missing = manifest === null;
const STALE = missing ? REBUILD : `The index was built by generator version ${manifest.version}, expected ${INDEX_VERSION}. ${REBUILD}`;
function present(password, list) {
  const digest = createHash('sha256').update(password).digest();
  const modulus = BigInt(list.bitCount);
  let bit = digest.readBigUInt64BE(0) % modulus;
  let step = (digest.readBigUInt64BE(8) % (modulus - 1n)) + 1n;
  const stepDelta = (digest.readBigUInt64BE(16) % (modulus - 1n)) + 1n;
  for (let i = 0; i < manifest.hashCount; i += 1) {
    const at = Number(bit);
    if (!(index[list.offset + (at >> 3)] & (1 << (at & 7)))) return false;
    bit = (bit + step) % modulus;
    step = (step + stepDelta) % modulus;
  }
  return true;
}
function presentAnywhere(password) {
  return manifest.lists.some((list) => present(password, list));
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
      if (Buffer.from(text).equals(line) && [...text].length >= 12 && [...text].length <= 256 && COMPOSITION.every((rule) => rule.test(text))) return text;
      start = newline + 1;
    }
    carry = data.subarray(start);
  }
  return null;
}
test('the shipped index was built by the current generator', (t) => {
  if (missing) return t.skip(REBUILD);
  assert.equal(manifest.version, INDEX_VERSION, STALE);
});
test('static common-password index covers every configured source with eligible entries', async (t) => {
  if (missing) return t.skip(REBUILD);
  const sourceNames = readdirSync(path.join(root, 'data/Known-Passwords'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(manifest.lists.map((list) => list.name), sourceNames);
  assert.equal(manifest.attribution, 'https://github.com/danielmiessler/SecLists');
  assert.equal(manifest.version, INDEX_VERSION, STALE);
  for (const list of manifest.lists) {
    const password = await firstEligible(path.join(root, 'data/Known-Passwords', list.name));
    if (password === null) {
      assert.equal(list.count, 0, `${list.name} has no policy-eligible entries`);
    } else {
      assert.ok(presentAnywhere(password), `${list.name} first entry has no false negative`);
    }
  }
});
test('every wordlist filter is large enough and full-period to avoid aliasing', (t) => {
  if (missing) return t.skip(REBUILD);
  const isPrime = (value) => {
    if (value < 2 || (value % 2 === 0 && value !== 2)) return value === 2;
    for (let factor = 3; factor * factor <= value; factor += 2) if (value % factor === 0) return false;
    return true;
  };
  for (const list of manifest.lists) {
    assert.ok(list.bitCount >= 65537, `${list.name} filter is too small at ${list.bitCount} bits`);
    assert.ok(isPrime(list.bitCount), `${list.name} filter modulus ${list.bitCount} is not prime`);
    assert.ok(list.bitCount >= list.count * manifest.bitsPerEntry, `${list.name} filter is too dense`);
    assert.equal(list.byteLength, Math.ceil(list.bitCount / 8));
  }
  const offsets = manifest.lists.reduce((total, list) => total + list.byteLength, 0);
  assert.equal(offsets, index.length, 'the index holds exactly the manifest filters');
  assert.ok(manifest.hashCount >= 30, `only ${manifest.hashCount} probes per lookup`);
});
test('the manifest publishes the false-positive rate the warning quotes', (t) => {
  if (missing) return t.skip(REBUILD);
  assert.equal(manifest.version, INDEX_VERSION, STALE);
  assert.ok(manifest.falsePositiveRate > 0, 'a combined rate is published');
  assert.ok(manifest.falsePositiveRate < 1e-6, `combined rate too high: ${manifest.falsePositiveRate}`);
  const summed = manifest.lists.reduce((total, list) => total + list.falsePositiveRate, 0);
  assert.ok(
    Math.abs(summed - manifest.falsePositiveRate) < manifest.falsePositiveRate,
    'the combined rate is the sum of the lists',
  );
  for (const list of manifest.lists) {
    assert.equal(typeof list.falsePositiveRate, 'number', `${list.name} publishes a rate`);
    assert.equal(typeof list.eligible, 'number', `${list.name} publishes its policy-eligible line count`);
    assert.ok(list.eligible >= list.count, `${list.name} stores more than it read`);
    if (list.count === 0) assert.equal(list.falsePositiveRate, 0, `${list.name} is empty but claims a rate`);
    else assert.ok(list.falsePositiveRate < 1e-7, `${list.name} rate too high: ${list.falsePositiveRate}`);
  }
});
test('empty wordlists reserve no set bits', (t) => {
  if (missing) return t.skip(REBUILD);
  assert.equal(manifest.version, INDEX_VERSION, STALE);
  for (const list of manifest.lists.filter((entry) => entry.count === 0)) {
    const slice = index.subarray(list.offset, list.offset + list.byteLength);
    assert.ok(slice.every((byte) => byte === 0), `${list.name} holds bits without entries`);
  }
});
test('unrelated strong passwords are not reported as wordlist matches', (t) => {
  if (missing) return t.skip(REBUILD);
  assert.equal(manifest.version, INDEX_VERSION, STALE);
  const samples = 20000;
  let matches = 0;
  for (let i = 0; i < samples; i += 1) {
    const password = `Zq7${createHash('sha256').update(`np-fp-probe-${i}`).digest('base64url').slice(0, 18)}`;
    if (presentAnywhere(password)) matches += 1;
  }
  assert.equal(matches, 0, `${matches} of ${samples} unrelated passwords were flagged`);
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
  if (missing) return t.skip(REBUILD);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let stdout;
    try {
      stdout = await dumpMatching(
        ['--virtual-time-budget=6000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`],
        /data-native-validation-message=""/,
      );
    } catch (error) {
      if (error instanceof ChromiumMissing) return t.skip('Chromium is not installed');
      throw error;
    }
    assert.match(stdout, /That password was found in a common password wordlist 100k-most-used-passwords-NCSC\.txt\. Choose another password\./);
    assert.match(stdout, /This check can misfire: about 1 in [\d,]+ unrelated passwords are reported by mistake\./);
    assert.match(stdout, /data-native-validation-message=""/);
    assert.match(stdout, /data-aria-invalid="true"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('every quipped password is actually in the shipped index', (t) => {
  if (missing) return t.skip(STALE);
  const script = readFileSync(path.join(root, 'public/js/common-password.js'), 'utf8');
  const quips = [...script.matchAll(/^\s{4}'([^']+)':\s'/gm)].map((match) => match[1]);
  assert.ok(quips.length >= 2, `the quip list was found in the script (saw ${quips.length})`);
  for (const password of quips) {
    assert.ok(
      presentAnywhere(password),
      `${password} is in a wordlist, so its quip can actually be reached`,
    );
  }
});
