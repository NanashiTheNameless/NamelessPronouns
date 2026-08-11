import './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, teaIsSteeped } from '../src/server.js';
import { ROBOTS_DIRECTIVES } from '../src/middleware/security-headers.js';
import { signValue } from '../src/util/cookies.js';
import config from '../src/config.js';
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
test('the public text-file and teapot eggs bypass consent', async () => {
  const teapot = await fetch(`${base}/teapot`);
  assert.equal(teapot.status, 418);
  assert.equal(teapot.headers.get('x-tea-made-by'), 'NamelessNanashi');
  assert.equal(teapot.headers.get('x-nanashi'), 'was-here');
  assert.equal(await teapot.text(), "I'm a teapot. It/its, thanks.\n");
  const curl = await fetch(`${base}/teapot`, { headers: { 'user-agent': 'curl/8.16.0' } });
  assert.equal(curl.headers.get('x-curl'), 'excellent-choice');
  const coffee = await fetch(`${base}/teapot?coffee`);
  assert.equal(coffee.status, 406);
  assert.equal(await coffee.text(), 'Wrong appliance.\n');
  const humans = await fetch(`${base}/humans.txt`);
  assert.equal(humans.status, 200);
  assert.match(await humans.text(), /humans behind NamelessPronouns/);
  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.equal(await robots.text(), '# Crawl if you like. You may not remember this place.\n# Nanashi was here. The crawler saw nothing.\nUser-agent: *\nAllow: /\n');
  const identity = await fetch(`${base}/.well-known/nameless`);
  assert.deepEqual(await identity.json(), { name: null, pronouns: 'any/all', owner: 'NamelessNanashi' });
  const pronouns = await fetch(`${base}/pronouns.txt`);
  assert.equal(pronouns.status, 200);
  assert.equal(await pronouns.text(), 'Pronouns: any/all\nOwner: NamelessNanashi\n\nThis file uses it/its.\n');
  const intentional = await fetch(`${base}/404`);
  assert.equal(intentional.status, 404);
  const intentionalHtml = await intentional.text();
  assert.match(intentionalHtml, /Congratulations\. You found it\./);
  assert.match(intentionalHtml, /data-404-return/);
  const owner404 = await fetch(`${base}/404?owner`);
  assert.equal(owner404.status, 404);
  assert.match(await owner404.text(), /return this page to NamelessNanashi/);
  const head = await fetch(`${base}/teapot`, { method: 'HEAD' });
  assert.equal(head.status, 418);
  assert.equal(head.headers.get('x-tea'), 'omitted');
  assert.equal(head.headers.get('x-tea-made-by'), 'NamelessNanashi');
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('link') || '', /<\/humans\.txt>; rel="author"/);
  const nothing = await fetch(`${base}/nothing`);
  assert.equal(nothing.status, 204);
  assert.equal(nothing.headers.get('x-nothing'), 'successfully-returned');
  assert.equal(nothing.headers.get('x-nothing-by'), 'NamelessNanashi');
  assert.equal(await nothing.text(), '');
  const something = await fetch(`${base}/nothing?something=true`);
  assert.equal(something.status, 409);
  assert.equal(await something.text(), 'That defeats the purpose.\n');
  const nothingAgain = await fetch(`${base}/nothing?again`);
  assert.equal(nothingAgain.status, 204);
  assert.equal(nothingAgain.headers.get('x-nothing-again'), 'yes');

  assert.equal(teaIsSteeped(Date.now() - 4 * 60 * 1000 - 18 * 1000), true);
  assert.equal(teaIsSteeped(Date.now() - 60 * 1000), false);
  const steeped = await fetch(`${base}/teapot`, {
    headers: { cookie: `np_tea_started=${Date.now() - 4 * 60 * 1000 - 18 * 1000}` },
  });
  assert.equal(steeped.status, 418);
  assert.equal(steeped.headers.get('x-tea-steeped'), 'precisely');
  assert.equal(await steeped.text(), 'Properly steeped. It/its, thanks.\n');
});
test('reserved Easter egg profiles bypass consent and database-backed sessions', async () => {
  const staleSession = signValue(config.COOKIE_SECRET, 'stale-session-that-would-query-the-database');
  for (const [username, heading, pronouns] of [
    ['void', 'Void', 'void/void'],
    ['infinity', 'Infinity', 'on/and/on'],
  ]) {
    const res = await fetch(`${base}/u/${username}`, { headers: { cookie: `np_sid=${staleSession}` } });
    assert.equal(res.status, 200, username);
    assert.equal(res.headers.get('x-pronouns'), pronouns, username);
    const html = await res.text();
    assert.match(html, new RegExp(`<h1>${heading}<\\/h1>`), username);
    assert.match(html, /data-profile-avatar/, username);
  }
});
test('GET / is gated: redirects to /consent before acceptance', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/consent');
});
test('GET /u/self reports a missing self when signed out', async () => {
  const consent = await fetch(`${base}/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ policies: 'on', age18: 'on', next: '/u/self' }),
  });
  const cookie = consent.headers.getSetCookie().find((value) => value.startsWith('np_policy='));
  const response = await fetch(`${base}/u/self`, { headers: { cookie } });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Self not found\./);
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
test('CSP names no remote origin until a page actually embeds one', async () => {
  const res = await fetch(`${base}/consent`);
  const csp = res.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /pronouns\.page/);
  assert.match(csp, /img-src 'self' data: https:\/\/www\.gravatar\.com;/, 'only the avatar provider is named');
  assert.match(csp, /media-src 'self' data:;/, 'no remote audio or video host by default');
  assert.match(csp, /frame-src 'none';/, 'and no embedding at all by default');
  assert.doesNotMatch(csp, /(img|media|frame)-src[^;]* https:;/, 'never a blanket allowance for all of HTTPS');
  assert.match(csp, /script-src 'self' 'nonce-[^']+'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /style-src 'self'/);
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
test('generated password index is static but not year-long immutable', async (t) => {
  const res = await fetch(`${base}/static/password-wordlists/manifest.json`);
  if (res.status === 404) return t.skip('Run: yarn build-password-index');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /json/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  const manifest = await res.json();
  assert.ok(manifest.lists.length > 0);
});

test('the ALTCHA challenge endpoint answers JSON without any session or consent', async () => {
  const res = await fetch(`${base}/altcha/challenge?for=signup`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const challenge = await res.json();
  for (const field of ['algorithm', 'challenge', 'salt', 'signature', 'maxnumber']) {
    assert.ok(challenge[field] !== undefined, `challenge carries ${field}`);
  }
  const expires = Number(new URLSearchParams(challenge.salt.split('?')[1]).get('expires'));
  assert.ok(expires > Math.floor(Date.now() / 1000), 'challenge expiry is in the future');
  assert.ok(expires < Math.floor(Date.now() / 1000) + 700, 'challenge expiry uses Unix seconds');
  const unknown = await fetch(`${base}/altcha/challenge?for=nonsense`, { redirect: 'manual' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get('content-type') || '', /application\/json/);
});
test('every session gate lets the challenge endpoint through', async () => {
  const { restrictedSessionGate } = await import('../src/middleware/restricted-session.js');
  const { deletionSessionGate } = await import('../src/middleware/deletion-session.js');
  const run = (gate, req) => {
    let passed = false;
    let redirected = null;
    gate({ ...req }, { redirect: (to) => { redirected = to; } }, () => { passed = true; });
    return { passed, redirected };
  };
  const path = '/altcha/challenge';
  assert.deepEqual(
    run(restrictedSessionGate(), { path, session: { restricted: 1 } }),
    { passed: true, redirected: null },
    'a restricted session can still fetch a challenge for the login form it is allowed to use',
  );
  assert.deepEqual(
    run(deletionSessionGate(), { path, deletionRequest: { id: 'del-1' } }),
    { passed: true, redirected: null },
    'a session pending deletion can still fetch a challenge',
  );
  assert.equal(run(restrictedSessionGate(), { path: '/dashboard', session: { restricted: 1 } }).redirected, '/account/suspended');
  assert.equal(run(deletionSessionGate(), { path: '/dashboard', deletionRequest: { id: 'del-1' } }).redirected, '/account/deletion');
});
test('every response tells search engines not to index or archive the page', async () => {
  const expected = ROBOTS_DIRECTIVES;
  assert.match(expected, /noindex/);
  assert.match(expected, /noarchive/);
  const paths = ['/', '/consent', '/terms', '/privacy', '/contact', '/legal-requests', '/acknowledgements', '/login', '/signup', '/dashboard', '/u/nobody-here', '/static/css/main.css'];
  for (const path of paths) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    assert.equal(res.headers.get('x-robots-tag'), expected, `${path} carries the directives`);
  }
  for (const path of ['/consent', '/terms', '/login']) {
    const html = await fetch(`${base}${path}`).then((res) => res.text());
    assert.ok(html.includes(`<meta name="robots" content="${expected}">`), path);
  }
});
