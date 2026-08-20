import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarUrl, validateAvatarDataUri, MAX_AVATAR_DATA_URI_BYTES } from '../src/avatar.js';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
test('avatar identicon is deterministic, symmetric SVG data', () => {
  const first = avatarUrl({ id: 'stable-user-id', avatar_source: 'identicon' });
  assert.equal(first, avatarUrl({ id: 'stable-user-id', avatar_source: 'identicon' }));
  assert.notEqual(first, avatarUrl({ id: 'other-user-id', avatar_source: 'identicon' }));
  assert.match(first, /^data:image\/svg\+xml,/);
});
test('avatar Gravatar uses the normalized email hash without exposing email', () => {
  const url = avatarUrl({ id: 'x', email: ' User@Example.COM ', avatar_source: 'gravatar' });
  assert.match(url, /^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{32}\?/);
  assert.doesNotMatch(url, /example|user@/i);
});
test('avatar Libravatar hashes the same normalized email with SHA-256', () => {
  const url = avatarUrl({ id: 'x', email: ' User@Example.COM ', avatar_source: 'libravatar' });
  assert.match(url, /^https:\/\/seccdn\.libravatar\.org\/avatar\/[a-f0-9]{64}\?/);
  assert.doesNotMatch(url, /example|user@/i);
  assert.notEqual(url, avatarUrl({ id: 'x', email: 'other@example.com', avatar_source: 'libravatar' }));
});
test('avatar data URI accepts bounded raster and sanitized SVG data', () => {
  assert.equal(validateAvatarDataUri(PNG), PNG);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#456"><circle cx="12" cy="12" r="10"/><path d="M8 12h8" stroke="#fff" stroke-width="2"/></g></svg>').toString('base64');
  const svgUri = `data:image/svg+xml;base64,${svg}`;
  assert.equal(validateAvatarDataUri(svgUri), svgUri);
  assert.throws(() => validateAvatarDataUri(`data:image/png;base64,${'A'.repeat(MAX_AVATAR_DATA_URI_BYTES)}`));
});
test('avatar SVG rejects scripts, handlers, links, styles, text, and external references', () => {
  const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')));
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')));
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>')));
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg"><circle style="fill:red"/></svg>')));
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>')));
  assert.throws(() => validateAvatarDataUri(uri('<svg xmlns="http://www.w3.org/2000/svg"><circle fill="url(https://example.com/x)"/></svg>')));
});
