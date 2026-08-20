import { createHash } from 'node:crypto';
export const MAX_AVATAR_DATA_URI_BYTES = 64 * 1024;
const DATA_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
const SVG_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'fill-opacity', 'stroke-opacity', 'transform',
]);
function validSvg(bytes) {
  const svg = bytes.toString('utf8');
  if (Buffer.from(svg, 'utf8').compare(bytes) !== 0 || /[\0-\x08\x0b\x0c\x0e-\x1f]/.test(svg)) return false;
  const stack = [];
  let cursor = 0;
  const tagRe = /<\/?[a-z][^<>]*>/g;
  for (const match of svg.matchAll(tagRe)) {
    if (match.index !== cursor && svg.slice(cursor, match.index).trim()) return false;
    cursor = match.index + match[0].length;
    const closing = match[0][1] === '/';
    const selfClosing = /\/>$/.test(match[0]);
    const name = /^<\/?([a-z]+)/.exec(match[0])?.[1];
    if (!name || !SVG_ELEMENTS.has(name)) return false;
    if (closing) {
      if (selfClosing || stack.pop() !== name || /[^\s>]/.test(match[0].slice(name.length + 2, -1))) return false;
      continue;
    }
    const body = match[0].slice(name.length + 1, selfClosing ? -2 : -1);
    const attrRe = /\s+([A-Za-z][\w:-]*)\s*=\s*"([^"]*)"/g;
    let attrCursor = 0;
    for (const attr of body.matchAll(attrRe)) {
      if (body.slice(attrCursor, attr.index).trim()) return false;
      attrCursor = attr.index + attr[0].length;
      if (!SVG_ATTRIBUTES.has(attr[1]) || /[<>&`]|url\s*\(/i.test(attr[2])) return false;
      if (attr[1] === 'xmlns' && attr[2] !== 'http://www.w3.org/2000/svg') return false;
    }
    if (body.slice(attrCursor).trim()) return false;
    if (!selfClosing) stack.push(name);
  }
  return cursor === svg.length && stack.length === 0 && /^<svg(?:\s|>)/.test(svg) && /<\/svg>$/.test(svg);
}
function validMagic(type, bytes) {
  if (type === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}
export function validateAvatarDataUri(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_AVATAR_DATA_URI_BYTES) {
    throw new Error(`Avatar data URI must be at most ${MAX_AVATAR_DATA_URI_BYTES} encoded bytes.`);
  }
  const match = DATA_RE.exec(value);
  if (!match) throw new Error('Avatar must be a base64 PNG, JPEG, WebP, or safe SVG data URI.');
  const bytes = Buffer.from(match[2], 'base64');
  const validImage = match[1] === 'svg+xml' ? validSvg(bytes) : validMagic(match[1], bytes);
  if (bytes.length === 0 || bytes.toString('base64') !== match[2] || !validImage) {
    throw new Error('Avatar image data is invalid.');
  }
  return value;
}
function emailDigest(email, algorithm) {
  return createHash(algorithm).update(String(email || '').trim().toLowerCase()).digest('hex');
}
function identicon(userId) {
  const digest = createHash('sha256').update(`nameless-avatar:v1:${userId}`).digest();
  const hue = ((digest[15] << 8) | digest[16]) % 360;
  const cells = [];
  let bit = 0;
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const filled = (digest[Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0;
      bit += 1;
      if (!filled) continue;
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      if (x !== 2) cells.push(`<rect x="${4 - x}" y="${y}" width="1" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5" fill="hsl(${hue} 28% 94%)"/><g fill="hsl(${hue} 68% 42%)">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export function profileAvatarUrl(profile, owner) {
  const source = profile?.avatar_source;
  if (!source || source === 'inherit') return avatarUrl(owner);
  return avatarUrl({
    id: profile.id,
    email: owner?.email,
    avatar_source: source,
    avatar_data_uri: profile.avatar_data_uri,
  });
}
export function avatarUrl(user) {
  if (user?.avatar_source === 'data' && user.avatar_data_uri) {
    try { return validateAvatarDataUri(user.avatar_data_uri); } catch {   }
  }
  if (user?.avatar_source === 'gravatar') {
    const emailHash = emailDigest(user.email, 'md5');
    return `https://www.gravatar.com/avatar/${emailHash}?s=160&d=mp&r=g`;
  }
  if (user?.avatar_source === 'libravatar') {
    const emailHash = emailDigest(user.email, 'sha256');
    return `https://seccdn.libravatar.org/avatar/${emailHash}?s=160&d=mm`;
  }
  return identicon(String(user?.id || 'anonymous'));
}
