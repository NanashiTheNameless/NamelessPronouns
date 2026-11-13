import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileCidrs, createCrawlerBanlist, crawlerFeeds, parseCrawlerFeed, scheduleCrawlerRefresh, crawlerRefreshInterval } from '../src/crawler-banlist.js';

test('CIDR matching handles IPv4, IPv6, boundaries and invalid or broad inputs', () => {
  const has = compileCidrs(['203.0.113.0/24', '2001:db8:1234::/48', '198.51.100.10']);
  for (const ip of ['203.0.113.0', '203.0.113.255', '::ffff:203.0.113.9', '2001:db8:1234::1', '198.51.100.10']) assert.equal(has(ip), true, ip);
  for (const ip of ['203.0.112.255', '203.0.114.0', '2001:db8:1235::', '198.51.100.11', 'bad', '', '203.0.113.9, 1.1.1.1', 'fe80::1%eth0']) assert.equal(has(ip), false, ip);
  for (const cidr of ['0.0.0.0/0', '::/0', '1.2.3.4/-1', '1.2.3.4/', '1.2.3.4/33', '2001:db8::/129', 'invalid']) assert.throws(() => compileCidrs([cidr]));
});

test('official JSON and Amazon HTML formats are validated, including single addresses', () => {
  const json = JSON.stringify({ prefixes: [{ ipv4Prefix: '203.0.113.8' }, { ipv6Prefix: '2001:db8::/32' }] });
  assert.deepEqual(parseCrawlerFeed(json), ['203.0.113.8', '2001:db8::/32']);
  assert.deepEqual(parseCrawlerFeed('<pre>{&quot;ip_prefix&quot;: &quot;203.0.113.8/32&quot;}</pre>', 'html'), ['203.0.113.8/32']);
  assert.deepEqual(parseCrawlerFeed('<pre>{"ipv4Prefix":"203.0.113.8"}</pre>', 'html'), ['203.0.113.8']);
  for (const body of ['{}', '{"prefixes":[]}', '{"prefixes":[{"ipv4Prefix":"0.0.0.0/0"}]}', '<html>Blocked</html>']) assert.throws(() => parseCrawlerFeed(body));
});

test('feed refresh retains good data on failures, persists atomically, expires old data and coalesces requests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'np-crawlers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cachePath = join(dir, 'ranges.json');
  let clock = Date.now();
  writeFileSync(cachePath, JSON.stringify({ feeds: [{ id: crawlerFeeds[0][0], url: crawlerFeeds[0][1], fetched_at: clock, cidrs: ['203.0.113.0/24'] }] }));
  let calls = 0;
  let fail = true;
  const fetcher = async () => { calls++; if (fail) throw new Error('offline'); return Response.json({ prefixes: [{ ipv4Prefix: '198.51.100.0/24' }] }); };
  const list = createCrawlerBanlist({ cachePath, seedPath: join(dir, 'missing.json'), fetcher, now: () => clock, warn() {}, extraCidrs: '192.0.2.7' });
  assert.equal(list.has('203.0.113.9'), true);
  const first = list.refresh();
  assert.equal(list.refresh(), first);
  await first;
  assert.equal(calls, crawlerFeeds.length);
  assert.equal(list.has('203.0.113.9'), true);
  await list.refresh();
  assert.equal(calls, crawlerFeeds.length, 'refresh does not run for every request');
  assert.ok(JSON.parse(readFileSync(cachePath)).feeds.length);
  clock += 31 * 86400_000;
  assert.equal(list.has('203.0.113.9'), false, 'expired feed stops matching even without a refresh');
  await list.refresh();
  assert.equal(list.has('203.0.113.9'), false);
  assert.equal(list.has('192.0.2.7'), true);
  fail = false;
  clock += 6 * 3600_000;
  await list.refresh();
  assert.equal(list.has('198.51.100.8'), true);
  assert.equal(list.snapshot().feeds.length, crawlerFeeds.length);
  assert.equal(createCrawlerBanlist({ cachePath, seedPath: join(dir, 'missing.json'), now: () => clock, warn() {} }).has('198.51.100.8'), true);
});

test('refresh scheduling runs at startup and every six hours, handles failure and unrefs the timer', async () => {
  let scheduled;
  let calls = 0;
  let warnings = 0;
  let unref = false;
  const timer = scheduleCrawlerRefresh({ refresh: async () => { calls++; throw new Error('offline'); } }, {
    warn: () => { warnings++; },
    setIntervalFn(callback, interval) {
      scheduled = callback;
      assert.equal(interval, 6 * 60 * 60 * 1000);
      assert.equal(interval, crawlerRefreshInterval);
      return { unref() { unref = true; } };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(warnings, 1);
  assert.equal(unref, true);
  assert.ok(timer);
  await scheduled();
  assert.equal(calls, 2);
  assert.equal(warnings, 2);
});

test('oversized or poisoned feeds never replace a good snapshot', async () => {
  const seedPath = new URL('../config/crawler-ip-ranges.json', import.meta.url);
  const list = createCrawlerBanlist({ seedPath, fetcher: async () => new Response('x'.repeat(1_000_001)), warn() {} });
  const before = list.snapshot();
  assert.ok(before.feeds.length > 0);
  await list.refresh();
  assert.deepEqual(list.snapshot(), before);
});

test('an older persisted cache cannot replace a newer bundled source', t => {
  const dir = mkdtempSync(join(tmpdir(), 'np-crawler-cache-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = Date.now();
  const seedPath = join(dir, 'seed.json');
  const cachePath = join(dir, 'cache.json');
  const source = { id: crawlerFeeds[0][0], url: crawlerFeeds[0][1] };
  writeFileSync(seedPath, JSON.stringify({ feeds: [{ ...source, fetched_at: clock, cidrs: ['203.0.113.0/24'] }] }));
  writeFileSync(cachePath, JSON.stringify({ feeds: [{ ...source, fetched_at: clock - 86400_000, cidrs: ['198.51.100.0/24'] }] }));
  const list = createCrawlerBanlist({ seedPath, cachePath, now: () => clock });
  assert.equal(list.has('203.0.113.9'), true);
  assert.equal(list.has('198.51.100.9'), false);
});
