import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import express from 'express';
import config from '../src/config.js';
import { createApp } from '../src/server.js';
import { botDefense, botClientIp, mazeRoot } from '../src/middleware/bot-defense.js';
import { securityHeaders } from '../src/middleware/security-headers.js';

const browser = 'Mozilla/5.0 (Linux; Android 14; CUBOT X70) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36';
const botConfig = { ...config, IOCAINE_URL: '', BOT_DEFENSE_ENABLED: true, BOT_TRAP_ENABLED: true, BOT_TRUST_CLOUDFLARE: false };
const banlist = { has: address => address === '203.0.113.8' };

async function serve(t, { options = {}, cfg = {}, realApp = false } = {}) {
  const settings = { ...botConfig, ...cfg };
  const app = realApp ? createApp({ crawlerBanlist: banlist, botConfig: settings, botOptions: { waitMs: 0, ...options } }) : express();
  let passed = 0;
  if (!realApp) {
    app.use(securityHeaders);
    app.use(botDefense({ config: settings, banlist, waitMs: 0, ...options }));
    app.use((req, res) => { passed++; res.type('text/plain').send('Real application'); });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, get: (path = '/', headers = {}) => fetch(`${base}${path}`, { headers }), passed: () => passed };
}

test('crawler reads receive decoys and writes are denied before the real application', async t => {
  const site = await serve(t);
  for (const agent of ['GPTBot/1', 'ClaudeBot/1', 'PerplexityBot/1', 'Googlebot/2', 'AhrefsBot/1', 'CCBot/1']) {
    for (const path of ['/', '/u/alice', '/static/uploads/avatar.png', '/account/export?token=secret']) {
      const res = await site.get(path, { 'user-agent': agent });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Reference archive/);
      assert.doesNotMatch(html, /alice|secret|token|avatar/);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.equal(res.headers.get('vary'), '*');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      assert.match(res.headers.get('x-robots-tag'), /noindex/);
    }
    const res = await fetch(`${site.base}/login`, { method: 'POST', body: 'password=private', headers: { 'user-agent': agent } });
    assert.equal(res.status, 403);
  }
  assert.equal(site.passed(), 0);
});

test('ordinary browsers, command line and accessibility tools pass; signed agents do not', async t => {
  const site = await serve(t);
  for (const agent of [browser, 'curl/8.16', 'Lynx/2.9', 'Mozilla/5.0 HeadlessChrome/140.0.0.0', 'undici']) {
    assert.equal(await (await site.get('/', { 'user-agent': agent })).text(), 'Real application');
  }
  for (const headers of [{ 'signature-agent': 'https://agent.example' }, { 'sec-web-bot-auth': 'agent' },
    { 'signature-input': 'sig=("@authority");tag="web-bot-auth"' }]) {
    assert.match(await (await site.get('/', headers)).text(), /Reference archive/);
  }
});

test('only explicitly trusted tunnel IPs classify browser-looking crawlers', async t => {
  const site = await serve(t);
  const spoofed = { 'user-agent': browser, 'cf-connecting-ip': '203.0.113.8', 'cf-ray': 'fake', 'x-forwarded-for': '203.0.113.8', 'iocaine-decision': 'garbage' };
  assert.equal(await (await site.get('/', spoofed)).text(), 'Real application');
  const tunnel = await serve(t, { cfg: { BOT_TRUST_CLOUDFLARE: true } });
  assert.match(await (await tunnel.get('/', spoofed)).text(), /Reference archive/);
  assert.equal((await fetch(`${tunnel.base}/account`, { method: 'POST', headers: spoofed })).status, 403);
  for (const address of ['203.0.113.8, 1.1.1.1', 'bad', 'fe80::1%eth0']) {
    assert.equal(await (await tunnel.get('/', { ...spoofed, 'cf-connecting-ip': address })).text(), 'Real application');
  }
  assert.equal(botClientIp({ socket: { remoteAddress: '::ffff:203.0.113.8' } }), '::ffff:203.0.113.8');
});

test('the test user agent opts into Iocaine per request and restoring it leaves no persistent trap', async t => {
  let calls = 0;
  const site = await serve(t, { cfg: { IOCAINE_URL: 'http://iocaine:42069' }, options: {
    fetcher: async () => { calls++; return new Response('<html>Iocaine test decoy</html>', { headers: { 'content-type': 'text/html' } }); },
  } });
  const cookie = 'np_session=same-browser-session';
  assert.equal(await (await site.get('/status', { 'user-agent': browser, cookie })).text(), 'Real application');
  for (const agent of ['NamelessPronouns-Tarpit-Test/1.0', `${browser} NamelessPronouns-Tarpit-Test/1.0`]) {
    const res = await site.get('/status', { 'user-agent': agent, cookie });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<html>Iocaine test decoy</html>');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(await (await site.get('/status', { 'user-agent': browser, cookie })).text(), 'Real application');
  }
  assert.equal(calls, 2);
  // Explicit archive URLs stay in the maze regardless of the user agent.
  assert.equal(await (await site.get(mazeRoot, { 'user-agent': browser, cookie })).text(), '<html>Iocaine test decoy</html>');
  assert.equal(await (await site.get('/status', { 'user-agent': browser, cookie })).text(), 'Real application');
});

test('archive links stay local, do not reflect input, accept only reads and can be disabled', async t => {
  const site = await serve(t);
  const html = await (await site.get(`${mazeRoot}/%3Cscript%3E?token=private`)).text();
  assert.doesNotMatch(html, /<script|private|token|<form|<iframe/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(links.length, 24);
  assert.ok(links.every(link => link.startsWith(`${mazeRoot}/`)));
  assert.match(await (await site.get(links[0])).text(), /Reference archive/);
  assert.ok(html.length < 20_000);
  const head = await fetch(`${site.base}${mazeRoot}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const write = await fetch(`${site.base}${mazeRoot}`, { method: 'POST' });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get('allow'), 'GET, HEAD');
  const noTrap = await serve(t, { cfg: { BOT_TRAP_ENABLED: false } });
  assert.equal((await noTrap.get('/', { 'user-agent': 'GPTBot/1' })).status, 403);
  assert.equal((await noTrap.get(mazeRoot)).status, 404);
  const off = await serve(t, { cfg: { BOT_DEFENSE_ENABLED: false } });
  assert.equal(await (await off.get('/', { 'user-agent': 'GPTBot/1' })).text(), 'Real application');
});

test('Iocaine gets only generated trap paths and application-created headers', async t => {
  const calls = [];
  const site = await serve(t, { cfg: { IOCAINE_URL: 'http://iocaine:42069' }, options: {
    fetcher: async (url, options) => { calls.push({ url, options }); return new Response('<html>Iocaine decoy</html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'leak=1', location: 'https://external.invalid' } }); },
  } });
  const res = await site.get('/account/export?token=secret', { 'user-agent': 'GPTBot/1', cookie: 'np_session=private', authorization: 'Bearer secret', 'iocaine-decision': 'default' });
  assert.equal(await res.text(), '<html>Iocaine decoy</html>');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('location'), null);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url.origin, 'http://iocaine:42069');
  assert.ok(url.pathname.startsWith(`${mazeRoot}/`));
  assert.doesNotMatch(url.href, /account|export|token|secret/);
  assert.equal(url.search, '');
  assert.deepEqual(options.headers, { accept: 'text/html', 'user-agent': 'NamelessPronouns-Archive', 'iocaine-decision': 'garbage' });
  assert.equal(options.redirect, 'error');
  await site.get(`${mazeRoot}/generated/link/`);
  assert.equal(calls[1].url.pathname, `${mazeRoot}/generated/link/`);
  await new Promise((resolve, reject) => {
    // Raw HTTP preserves encoded dot segments that fetch would normalize locally.
    const req = httpRequest(`${site.base}`, { path: `${mazeRoot}/%2e%2e/outside` }, response => {
      response.resume();
      response.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(calls[2].url.pathname, `${mazeRoot}/index/`);
});

test('Iocaine errors, redirects, fallthrough and oversized output use bounded fallback with backoff', async t => {
  for (const response of [() => { throw new Error('offline'); }, () => new Response(null, { status: 421 }),
    () => new Response(null, { status: 302, headers: { location: 'https://outside.invalid' } }),
    () => new Response('x'.repeat(65 * 1024), { headers: { 'content-type': 'text/html' } }),
    () => new Response('not HTML')]) {
    let calls = 0;
    let clock = 1000;
    const site = await serve(t, { cfg: { IOCAINE_URL: 'http://iocaine:42069' }, options: {
      now: () => clock, fetcher: async () => { calls++; return response(); },
    } });
    for (let i = 0; i < 2; i++) assert.match(await (await site.get(mazeRoot)).text(), /Reference archive/);
    assert.equal(calls, 1, 'requests during backoff do not retry failed upstream');
    clock += 30_001;
    await site.get(mazeRoot);
    assert.equal(calls, 2);
    assert.equal(site.passed(), 0, 'fallthrough never exposes the real application to a trapped crawler');
  }
});

test('upstream timeout and concurrency limits leave normal pages available', async t => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const site = await serve(t, { cfg: { IOCAINE_URL: 'http://iocaine:42069' }, options: {
    maxActive: 1, timeoutMs: 80,
    fetcher: async (url, { signal }) => {
      started();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  } });
  const first = site.get(mazeRoot);
  await began;
  const excess = await site.get(mazeRoot);
  assert.equal(excess.status, 429);
  assert.equal(excess.headers.get('retry-after'), '30');
  assert.equal(await (await site.get('/status')).text(), 'Real application');
  assert.match(await (await first).text(), /Reference archive/);
  assert.equal((await site.get(mazeRoot)).status, 200, 'slot released after timeout');
});

test('disconnect cancels the upstream and releases the active request slot', async t => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  let cancelled;
  const aborted = new Promise(resolve => { cancelled = resolve; });
  const site = await serve(t, { cfg: { IOCAINE_URL: 'http://iocaine:42069' }, options: {
    maxActive: 1,
    fetcher: async (url, { signal }) => {
      started();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true }));
    },
  } });
  const req = httpRequest(`${site.base}${mazeRoot}`);
  req.on('error', () => {});
  req.end();
  await began;
  req.destroy();
  await aborted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await site.get(mazeRoot)).status, 200);
});

test('real app exposes policy and monitoring, hides the honeypot, and intercepts profile requests', async t => {
  const site = await serve(t, { realApp: true });
  const robots = await site.get('/robots.txt', { 'user-agent': 'GPTBot/1' });
  assert.match(await robots.text(), /Disallow: \//);
  const consent = await site.get('/consent', { 'user-agent': browser });
  assert.match(await consent.text(), /href="\/reference-archive\/index\/" hidden aria-hidden="true" tabindex="-1" rel="nofollow"/);
  assert.match(await (await site.get('/u/alice', { 'user-agent': 'GPTBot/1', cookie: 'np_session=invalid' })).text(), /Reference archive/);
  const health = await site.get('/healthz', { 'user-agent': 'GPTBot/1' });
  assert.equal(health.headers.get('content-type').includes('application/json'), true);
  const noTrap = await serve(t, { realApp: true, cfg: { BOT_TRAP_ENABLED: false } });
  assert.doesNotMatch(await (await noTrap.get('/consent')).text(), /reference-archive/);
});

test('Iocaine origin configuration rejects credentials, paths and non-HTTP schemes', () => {
  for (const IOCAINE_URL of ['file:///etc/passwd', 'http://user:pass@localhost', 'http://localhost/path', 'http://localhost/?token=secret', 'http://localhost/#fragment']) {
    assert.throws(() => botDefense({ config: { ...botConfig, IOCAINE_URL }, banlist }));
  }
});
