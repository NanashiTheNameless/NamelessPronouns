import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEmbeddedOrigins } from '../src/html-sanitize.js';
import { allowEmbeddedOrigins, cspFor } from '../src/middleware/security-headers.js';
function fakeResponse() {
  return { locals: {}, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
}
test('embedded origins are read from the rendered profile only', () => {
  const found = collectEmbeddedOrigins(
    '<img src="https://cdn.example/a.png" loading="lazy">'
    + '<img src="/static/flags/Queer.png">'
    + '<video poster="https://shots.example/p.jpg"><source src="https://media.example/v.mp4"></video>'
    + '<iframe src="https://www.youtube.com/embed/x"></iframe>',
  );
  assert.deepEqual([...found.images].sort(), ['https://cdn.example', 'https://media.example', 'https://shots.example']);
  assert.deepEqual([...found.media].sort(), ['https://media.example'], 'a poster is an image, not media');
  assert.deepEqual([...found.frames], ['https://www.youtube.com']);
  const none = collectEmbeddedOrigins('<p>plain <strong>text</strong></p><img src="/static/x.png">');
  assert.deepEqual([[...none.images], [...none.media], [...none.frames]], [[], [], []], 'site paths need no allowance');
});
test('a profile that embeds nothing keeps the closed policy', () => {
  const res = fakeResponse();
  const csp = cspFor(res, { rum: true });
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /img-src 'self' data: https:\/\/www\.gravatar\.com/);
  assert.doesNotMatch(csp, / https:;/);
});
test('a profile that embeds media widens the policy to exactly those hosts', () => {
  const res = fakeResponse();
  res.locals.publicPage = true;
  allowEmbeddedOrigins(res, collectEmbeddedOrigins(
    '<img src="https://cdn.example/a.png"><iframe src="https://www.youtube.com/embed/x"></iframe>',
  ));
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /img-src 'self' data: https:\/\/www\.gravatar\.com https:\/\/cdn\.example;/);
  assert.match(csp, /frame-src https:\/\/www\.youtube\.com;/);
  assert.match(csp, /media-src 'self' data:;/, 'a directive with nothing embedded stays closed');
  assert.match(csp, /script-src 'self' 'nonce-[^']+' https:\/\/static\.cloudflareinsights\.com/, 'public pages keep RUM');
  assert.doesNotMatch(csp, /https:\/\/evil\.example/);
});
test('bad or excessive origins never reach the header', () => {
  const res = fakeResponse();
  const images = new Set(['https://a-ok.example', 'http://insecure.example', "https://x.example' 'unsafe-inline",
    'https://a.example/path', 'javascript:alert(1)']);
  for (let index = 0; index < 40; index += 1) images.add(`https://host${index}.example`);
  allowEmbeddedOrigins(res, { images, media: new Set(), frames: new Set() });
  const directive = /img-src ([^;]*)/.exec(res.headers['content-security-policy'])[1];
  assert.doesNotMatch(directive, /insecure|unsafe-inline|javascript:|\/path/);
  assert.ok(directive.includes('https://a-ok.example'), 'a valid host still makes the list');
  assert.ok(directive.split(' ').length <= 27, `the list is capped, saw ${directive.split(' ').length} sources`);
});
