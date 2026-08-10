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
const BITS_PER_ENTRY = 29;
const HASH_COUNT = 20;
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
function eligible(line) {
  const text = line.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(line)) return false;
  const length = [...text].length;
  return length >= 12 && length <= 256;
}
function add(bits, bitCount, value) {
  const digest = createHash('sha256').update(value).digest();
  const h1 = digest.readBigUInt64BE(0);
  const h2 = digest.readBigUInt64BE(8) | 1n;
  const modulus = BigInt(bitCount);
  for (let i = 0; i < HASH_COUNT; i += 1) {
    const bit = Number((h1 + BigInt(i) * h2) % modulus);
    bits[bit >> 3] |= 1 << (bit & 7);
  }
}
mkdirSync(output, { recursive: true });
const manifest = { version: 1, hash: 'SHA-256', hashCount: HASH_COUNT, attribution: 'https://github.com/danielmiessler/SecLists', lists: [] };
const outputPath = path.join(output, 'index.bin');
const stream = createWriteStream(outputPath);
let offset = 0;
for (const name of names) {
  const file = path.join(root, name);
  let count = 0;
  await eachLine(file, (line) => { if (eligible(line)) count += 1; });
  const bitCount = Math.max(64, count * BITS_PER_ENTRY);
  const bits = Buffer.alloc(Math.ceil(bitCount / 8));
  await eachLine(file, (line) => { if (eligible(line)) add(bits, bitCount, line); });
  stream.write(bits);
  manifest.lists.push({ name, count, bitCount, offset, byteLength: bits.length });
  offset += bits.length;
}
await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
console.log(`Built ${manifest.lists.length} wordlist filters (${offset} bytes).`);
