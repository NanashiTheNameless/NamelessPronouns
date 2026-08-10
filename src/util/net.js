import config from '../config.js';
import { hmac } from './crypto.js';
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf;
  return req.ip || '';
}
export function ipPrefix(ip) {
  if (!ip) return '';
  if (ip.includes(':')) {
    const groups = ip.split(':');
    return `${groups.slice(0, 3).join(':')}::/48`;
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return ip;
  return `${octets.slice(0, 3).join('.')}.0/24`;
}
export function ipPrefixHash(req) {
  const prefix = ipPrefix(clientIp(req));
  return prefix ? hmac(config.TOKEN_HASH_KEY, `ipprefix:${prefix}`) : null;
}
export function ipToBigInt(ip) {
  if (!ip) return null;
  const s = ip.trim();
  if (s.includes(':')) {
    let addr = s;
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    let tail = '';
    if (v4) {
      const o = v4[1].split('.').map(Number);
      if (o.some((n) => n > 255)) return null;
      tail = `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
      addr = addr.slice(0, v4.index) + tail;
    }
    const halves = addr.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const back = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - back.length;
    if (missing < 0) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...back];
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const g of groups) {
      const n = BigInt(parseInt(g || '0', 16));
      if (n < 0n || n > 0xffffn) return null;
      value = (value << 16n) | n;
    }
    return { value, bits: 128 };
  }
  const octets = s.split('.');
  if (octets.length !== 4) return null;
  let value = 0n;
  for (const oct of octets) {
    const n = Number(oct);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return { value, bits: 32 };
}
export function ipInCidr(ip, network, prefixLen) {
  const a = ipToBigInt(ip);
  const b = ipToBigInt(network);
  if (!a || !b || a.bits !== b.bits) return false;
  const len = Number(prefixLen);
  if (!Number.isInteger(len) || len < 0 || len > a.bits) return false;
  const shift = BigInt(a.bits - len);
  return a.value >> shift === b.value >> shift;
}
