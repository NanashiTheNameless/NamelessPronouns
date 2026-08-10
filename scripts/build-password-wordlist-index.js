import { createReadStream, mkdirSync, writeFileSync, createWriteStream, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../data/Known-Passwords/', import.meta.url));
const output = fileURLToPath(new URL('../public/password-wordlists/', import.meta.url));
const names = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, 'en'));
if (!names.length) throw new Error(`No .txt password wordlists found in ${root}`);
const BITS_PER_ENTRY = 48;
const HASH_COUNT = Math.round(BITS_PER_ENTRY * Math.LN2);
const MIN_BITS = 1 << 16;
const PROGRESS_LINES = 250000;
const live = process.stdout.isTTY;
const CLEAR_LINE = '\r\u001b[K';
function isPrime(value) {
  if (value < 2) return false;
  if (value % 2 === 0) return value === 2;
  for (let factor = 3; factor * factor <= value; factor += 2) {
    if (value % factor === 0) return false;
  }
  return true;
}
function filterBitCount(count) {
  let candidate = Math.max(MIN_BITS, count * BITS_PER_ENTRY);
  if (candidate % 2 === 0) candidate += 1;
  while (!isPrime(candidate)) candidate += 2;
  return candidate;
}
function seconds(from) {
  return `${((Date.now() - from) / 1000).toFixed(1)}s`;
}
function step(index, name, text) {
  if (live) process.stdout.write(CLEAR_LINE);
  console.log(`[${String(index + 1).padStart(2)}/${names.length}] ${name.padEnd(48)} ${text}`);
}
function progress(index, name, text) {
  if (!live) return;
  process.stdout.write(`${CLEAR_LINE}[${String(index + 1).padStart(2)}/${names.length}] ${name.padEnd(48)} ${text}`);
}
async function eachLine(file, visit) {
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { highWaterMark: 512 * 1024 })) {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const newline = data.indexOf(10, start);
      if (newline < 0) break;
      let line = data.subarray(start, newline);
      if (line.length && line[line.length - 1] === 13) line = line.subarray(0, -1);
      visit(line);
      start = newline + 1;
    }
    carry = data.subarray(start);
  }
  if (carry.length) visit(carry[carry.length - 1] === 13 ? carry.subarray(0, -1) : carry);
}
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
function eligible(line) {
  const text = line.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(line)) return false;
  const length = [...text].length;
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH;
}
function dedupeKey(line) {
  return createHash('sha256').update(line).digest('base64').slice(0, 22);
}
function probeBits(value, bitCount) {
  const digest = createHash('sha256').update(value).digest();
  const modulus = BigInt(bitCount);
  let bit = digest.readBigUInt64BE(0) % modulus;
  let step = (digest.readBigUInt64BE(8) % (modulus - 1n)) + 1n;
  const stepDelta = (digest.readBigUInt64BE(16) % (modulus - 1n)) + 1n;
  const bits = [];
  for (let i = 0; i < HASH_COUNT; i += 1) {
    bits.push(Number(bit));
    bit = (bit + step) % modulus;
    step = (step + stepDelta) % modulus;
  }
  return bits;
}
function add(bits, bitCount, value) {
  for (const bit of probeBits(value, bitCount)) {
    bits[bit >> 3] |= 1 << (bit & 7);
  }
}
const POPCOUNT = Uint8Array.from({ length: 256 }, (_, byte) => byte.toString(2).replace(/0/g, '').length);
function falsePositiveRate(bits, bitCount) {
  let set = 0;
  for (const byte of bits) set += POPCOUNT[byte];
  return (set / bitCount) ** HASH_COUNT;
}
mkdirSync(output, { recursive: true });
const started = Date.now();
console.log(`Indexing ${names.length} wordlists at ${BITS_PER_ENTRY} bits/entry with ${HASH_COUNT} probes.`);
console.log(`Pass 1 of 2: counting entries and removing cross-list duplicates. Only ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} character entries are eligible, because the password policy rejects anything shorter or longer.`);
let seen = new Set();
const counts = [];
const eligibleCounts = [];
let lineTotal = 0;
let eligibleTotal = 0;
for (const [index, name] of names.entries()) {
  const listStarted = Date.now();
  let lines = 0;
  let scanned = 0;
  let unique = 0;
  await eachLine(path.join(root, name), (line) => {
    lines += 1;
    if (lines % PROGRESS_LINES === 0) progress(index, name, `scanning, ${lines.toLocaleString('en')} lines read`);
    if (!eligible(line)) return;
    scanned += 1;
    const key = dedupeKey(line);
    if (!seen.has(key)) {
      seen.add(key);
      unique += 1;
    }
  });
  lineTotal += lines;
  eligibleTotal += scanned;
  counts.push(unique);
  eligibleCounts.push(scanned);
  const tooShort = lines - scanned;
  const parts = [`${lines.toLocaleString('en')} lines`];
  parts.push(`${scanned.toLocaleString('en')} within policy length`);
  if (tooShort) parts.push(`${tooShort.toLocaleString('en')} skipped`);
  if (scanned !== unique) parts.push(`${(scanned - unique).toLocaleString('en')} already covered`);
  parts.push(`${unique.toLocaleString('en')} new`);
  step(index, name, `${parts.join(', ')} in ${seconds(listStarted)}`);
}
const uniqueTotal = seen.size;
seen = null;
const duplicateShare = eligibleTotal ? ((1 - uniqueTotal / eligibleTotal) * 100).toFixed(1) : '0.0';
console.log(`Pass 1 complete: ${lineTotal.toLocaleString('en')} lines read, ${eligibleTotal.toLocaleString('en')} within policy length, ${uniqueTotal.toLocaleString('en')} unique (${duplicateShare}% duplicates) in ${seconds(started)}.`);
console.log('Pass 2 of 2: building filters.');
const manifest = {
  version: 3,
  hash: 'SHA-256',
  hashCount: HASH_COUNT,
  bitsPerEntry: BITS_PER_ENTRY,
  attribution: 'https://github.com/danielmiessler/SecLists',
  lists: [],
};
const outputPath = path.join(output, 'index.bin');
const stream = createWriteStream(outputPath);
let offset = 0;
seen = new Set();
for (const [index, name] of names.entries()) {
  const listStarted = Date.now();
  const count = counts[index];
  const bitCount = filterBitCount(count);
  const bits = Buffer.alloc(Math.ceil(bitCount / 8));
  let stored = 0;
  await eachLine(path.join(root, name), (line) => {
    if (!eligible(line)) return;
    const key = dedupeKey(line);
    if (seen.has(key)) return;
    seen.add(key);
    add(bits, bitCount, line);
    stored += 1;
    if (stored % PROGRESS_LINES === 0) progress(index, name, `building, ${stored.toLocaleString('en')} of ${count.toLocaleString('en')} entries`);
  });
  if (stored !== count) throw new Error(`${name} stored ${stored} entries but counted ${count}`);
  if (!stream.write(bits)) await new Promise((resolve) => stream.once('drain', resolve));
  const rate = falsePositiveRate(bits, bitCount);
  manifest.lists.push({
    name, count, eligible: eligibleCounts[index], bitCount, offset,
    byteLength: bits.length, falsePositiveRate: Number(rate.toExponential(3)),
  });
  offset += bits.length;
  const odds = rate > 0 ? `1 in ${Math.round(1 / rate).toLocaleString('en')} false matches` : 'no stored entries';
  step(index, name, `${bits.length.toLocaleString('en')} bytes, ${odds}, in ${seconds(listStarted)}`);
}
await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));
const combined = manifest.lists.reduce((total, list) => total + list.falsePositiveRate, 0);
manifest.falsePositiveRate = Number(combined.toExponential(3));
writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
console.log(`Built ${manifest.lists.length} filters over ${uniqueTotal.toLocaleString('en')} entries, ${offset.toLocaleString('en')} bytes, in ${seconds(started)}.`);
console.log(`Measured false-positive rate: ${manifest.falsePositiveRate.toExponential(2)} (about 1 in ${Math.round(1 / combined).toLocaleString('en')} unrelated passwords).`);
