import './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
test('GET / is gated: redirects to /consent before acceptance', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/consent');
});
test('GET /consent renders with baseline security headers and RUM allowance', async () => {
  const res = await fetch(`${base}/consent`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /static\.cloudflareinsights\.com/);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null);
  const html = await res.text();
  assert.match(html, /Cloudflare/);
  assert.match(html, /name="policies"/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  assert.match(html, /href="\/terms" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="\/privacy" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /version 2026|name="terms"|name="privacy"/);
});
test('CSP uses a fresh random script nonce for every response', async () => {
  const first = await fetch(`${base}/consent`);
  const second = await fetch(`${base}/consent`);
  const firstNonce = /script-src[^;]*'nonce-([^']+)'/.exec(first.headers.get('content-security-policy'))?.[1];
  const secondNonce = /script-src[^;]*'nonce-([^']+)'/.exec(second.headers.get('content-security-policy'))?.[1];
  assert.ok(firstNonce);
  assert.ok(secondNonce);
  assert.equal(Buffer.from(firstNonce, 'base64').length, 16);
  assert.equal(Buffer.from(secondNonce, 'base64').length, 16);
  assert.notEqual(firstNonce, secondNonce);
});
test('signup reason is a tall 20 to 5000 character textarea', async () => {
  const consent = await fetch(`${base}/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ policies: 'on', age18: 'on', next: '/signup' }),
  });
  const cookie = consent.headers.getSetCookie().find((value) => value.startsWith('np_policy='));
  const response = await fetch(`${base}/signup`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<textarea[^>]+id="reason"[^>]+rows="10"[^>]+minlength="20"[^>]+maxlength="5000"[^>]*>/);
  assert.match(html, /name="policies" required/);
  assert.match(html, /Terms of Service[\s\S]+Privacy Policy/);
  assert.match(html, /<altcha-widget[\s\S]+type="checkbox"[\s\S]+display="standard"[\s\S]+auto="onsubmit"[\s\S]+theme="business"/);
  assert.match(html, /"hideFooter":false,"hideLogo":true/);
});
test('legal and contact pages contain their real public content before consent', async () => {
  const cases = [
    ['/terms', /Lost-factor administrative recovery is case-by-case/],
    ['/privacy', /We do not sell personal information/],
    ['/contact', /data-obfuscated=/],
    ['/legal-requests', /non-binding administrative warrants/],
    ['/acknowledgements', /SecLists maintainers and contributors/],
  ];
  for (const [path, expected] of cases) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, expected, path);
    assert.doesNotMatch(html, /server-rendered placeholder/i, path);
  }
});
test('rendered informational pages never expose the operator email', async () => {
  for (const path of ['/terms', '/privacy', '/contact', '/legal-requests', '/acknowledgements']) {
    const res = await fetch(`${base}${path}`);
    const html = await res.text();
    assert.doesNotMatch(html, /Nanashi@NamelessNanashi\.dev/i, path);
    assert.match(html, /\/static\/js\/email-obfuscation\.js/, path);
  }
});
test('self-hosted ALTCHA obfuscation assets are available', async () => {
  for (const path of ['/static/vendor/altcha/obfuscation.js', '/static/vendor/altcha/widget.js']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type') || '', /javascript/, path);
  }
});
test('GET /healthz returns 503 when database is unreachable', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.status, 'unavailable');
});
test('gate redirects unknown non-exempt path to /consent with safe next', async () => {
  const res = await fetch(`${base}/nope`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/consent?next=%2Fnope');
});
test('export capability requires consent without leaking its bearer token', async () => {
  const token = 'secret-export-capability-token';
  const res = await fetch(`${base}/account/export/download/${token}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/consent');
  assert.doesNotMatch(res.headers.get('location'), new RegExp(token));
  const returnCookie = res.headers.getSetCookie().find((cookie) => cookie.startsWith('np_consent_return='));
  assert.ok(returnCookie, 'encrypted return cookie is set');
  assert.doesNotMatch(returnCookie, new RegExp(token), 'cookie does not expose the bearer token');
});
test('static assets are exempt from the gate', async () => {
  const res = await fetch(`${base}/static/vendor/altcha/widget.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  const font = await fetch(`${base}/static/fonts/0xproto/0xProto-Regular.woff2`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type') || '', /font\/woff2/);
  const flag = await fetch(`${base}/static/flags/Nonbinary.png`);
  assert.equal(flag.status, 200);
  assert.match(flag.headers.get('content-type') || '', /image\/png/);
});
test('CSP keeps profile flag images on the local origin', async () => {
  const res = await fetch(`${base}/consent`);
  const csp = res.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /pronouns\.page/);
  assert.match(csp, /img-src 'self'/);
});
test('site text colors stay white across semantic states', async () => {
  const res = await fetch(`${base}/static/css/main.css`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  const css = await res.text();
  for (const variable of ['text', 'muted', 'danger', 'success']) {
    assert.match(css, new RegExp(`--${variable}: #ffffff`));
  }
  assert.match(css, /\.eyebrow\s*\{[^}]*color:\s*var\(--accent\)/s);
  assert.doesNotMatch(css, /^\s*color:\s*rgba\(/m);
  const page = await fetch(`${base}/consent`);
  const cssText = await page.text();
  assert.match(cssText, /\/static\/css\/main\.css/);
  assert.match(css, /\[data-illegal-characters\]/);
  const js = await fetch(`${base}/static/js/profile-editor.js`);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=3600');
});
test('generated password index is static but not year-long immutable', async () => {
  const res = await fetch(`${base}/static/password-wordlists/manifest.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /json/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  const manifest = await res.json();
  assert.ok(manifest.lists.length > 0);
});
