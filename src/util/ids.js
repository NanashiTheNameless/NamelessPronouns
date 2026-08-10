import { randomUUID, randomBytes } from 'node:crypto';
export function newId() {
  return randomUUID();
}
export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
export function newNumericCode(digits = 6) {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  let n;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= limit);
  return String(n % max).padStart(digits, '0');
}
