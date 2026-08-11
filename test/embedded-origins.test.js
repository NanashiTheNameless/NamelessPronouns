import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectCodeUsage, collectEmbeddedOrigins } from '../src/html-sanitize.js';
import { allowProfileContent, cspFor } from '../src/middleware/security-headers.js';
import { fullMarkdownAllowed } from '../src/middleware/staff.js';
import { renderProfileMarkdown } from '../src/markdown.js';
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
  allowProfileContent(res, collectEmbeddedOrigins(
    '<img src="https://cdn.example/a.png"><iframe src="https://www.youtube.com/embed/x"></iframe>',
  ), null, { permitted: true });
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
  allowProfileContent(res, { images, media: new Set(), frames: new Set() }, null, { permitted: true });
  const directive = /img-src ([^;]*)/.exec(res.headers['content-security-policy'])[1];
  assert.doesNotMatch(directive, /insecure|unsafe-inline|javascript:|\/path/);
  assert.ok(directive.includes('https://a-ok.example'), 'a valid host still makes the list');
  assert.ok(directive.split(' ').length <= 27, `the list is capped, saw ${directive.split(' ').length} sources`);
});

const EMBEDS = [
  '<img src="https://cdn.example/a.png" alt="a">',
  '<iframe src="https://www.youtube.com/embed/x"></iframe>',
  '<video src="https://media.example/v.mp4" controls></video>',
  '![art](https://cdn.example/art.png)',
  'bare https://cdn.example/x.png',
].join('\n\n');
test('only an Administrator or Owner profile can produce embedded media at all', async () => {
  for (const role of ['none', 'support', 'moderator']) {
    const full = fullMarkdownAllowed(role);
    assert.equal(full, false, `${role} does not get the wider Markdown set`);
    const html = await renderProfileMarkdown(EMBEDS, { full });
    assert.doesNotMatch(html, /<img|<iframe|<video|<audio|<source/, `${role} content renders no media tags`);
    assert.match(html, /&lt;img src=/, `${role} content shows the tag as text instead`);
    const found = collectEmbeddedOrigins(html);
    assert.deepEqual([[...found.images], [...found.media], [...found.frames]], [[], [], []],
      `${role} content contributes no origin`);
  }
  for (const role of ['administrator', 'owner']) {
    assert.equal(fullMarkdownAllowed(role), true);
    const html = await renderProfileMarkdown(EMBEDS, { full: true });
    const found = collectEmbeddedOrigins(html);
    assert.deepEqual([...found.frames], ['https://www.youtube.com'], `${role} may embed a frame`);
    assert.ok(found.images.has('https://cdn.example'), `${role} may embed an image`);
    assert.ok(found.media.has('https://media.example'), `${role} may embed a video`);
  }
});
test('the policy stays closed for content that is not permitted to run or embed', () => {
  const html = '<img src="https://cdn.example/a.png"><iframe src="https://evil.example/x"></iframe><script>go()</script>';
  const embedded = collectEmbeddedOrigins(html);
  const usage = collectCodeUsage(html);
  for (const options of [undefined, {}, { permitted: false }, { permitted: 'yes' }, { permitted: 1 }]) {
    const res = fakeResponse();
    assert.equal(allowProfileContent(res, embedded, usage, options), null,
      `permitted=${JSON.stringify(options)} must not widen the policy`);
    assert.equal(res.headers['content-security-policy'], undefined, 'the response keeps the policy it already had');
  }
  const res = fakeResponse();
  assert.equal(
    allowProfileContent(res, collectEmbeddedOrigins('<p>plain</p>'), collectCodeUsage('<p>plain</p>'), { permitted: true }),
    null,
    'an Administrator profile with no code and nothing embedded is left closed too',
  );
  assert.equal(res.headers['content-security-policy'], undefined);
});
test('the policy picks a signed script nonce when that is enough, and relaxes only when it must', () => {
  const scriptOnly = '<script>go()</script>';
  const withHandler = '<button onclick="go()">g</button>';
  const withScheme = '<a href="javascript:go()">g</a>';
  const nonced = fakeResponse();
  nonced.locals.publicPage = true;
  assert.equal(allowProfileContent(nonced, collectEmbeddedOrigins(scriptOnly), collectCodeUsage(scriptOnly), { permitted: true }), 'nonce');
  const noncedCsp = nonced.headers['content-security-policy'];
  assert.match(noncedCsp, /script-src 'self' 'nonce-[^']+' https:\/\/static\.cloudflareinsights\.com/);
  assert.doesNotMatch(noncedCsp, /unsafe-inline/, 'a script block never needs the relaxed policy');
  for (const html of [withHandler, withScheme]) {
    const res = fakeResponse();
    assert.equal(allowProfileContent(res, collectEmbeddedOrigins(html), collectCodeUsage(html), { permitted: true }), 'inline');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(csp, /nonce-/, 'a nonce would cancel the inline allowance, so it is left out');
  }
  const external = '<script src="https://s.example/a.js"></script>';
  const remote = fakeResponse();
  assert.equal(allowProfileContent(remote, collectEmbeddedOrigins(external), collectCodeUsage(external), { permitted: true }), 'nonce');
  assert.match(remote.headers['content-security-policy'], /script-src 'self' 'nonce-[^']+' https:\/\/s\.example/);
});
test('object, embed and form targets widen only their own directives', () => {
  const html = '<object data="https://o.example/a.pdf"></object><form action="https://f.example/s"></form>';
  const res = fakeResponse();
  allowProfileContent(res, collectEmbeddedOrigins(html), collectCodeUsage(html), { permitted: true });
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /object-src https:\/\/o\.example(;|$)/);
  assert.match(csp, /form-action 'self' https:\/\/f\.example;/);
  assert.match(csp, /frame-src 'none';/, 'an unrelated directive stays shut');
});
test('the public profile route ties the widening to the profile owner staff role', async () => {
  const route = await readFile(new URL('../src/routes/public-profile.js', import.meta.url), 'utf8');
  assert.match(route, /const full = fullMarkdownAllowed\(profile\.staff_role\);/,
    'the tier comes from the account that owns the profile, never from the viewer');
  const calls = [...route.matchAll(/allowProfileContent\(/g)];
  assert.equal(calls.length, 1, 'exactly one place can widen the policy');
  const statement = route.slice(calls[0].index, route.indexOf(';', calls[0].index));
  assert.match(statement, /permitted: full/, 'and that place is gated on the tier');
  assert.doesNotMatch(route, /req\.user\.staff_role/, 'a viewer cannot raise the tier by being staff');
});
