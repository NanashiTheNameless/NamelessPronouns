import { BlockList, isIP } from 'node:net';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

// Operator-published crawler feeds only. Never use whole AWS/Azure/GCP or residential-proxy ranges.
export const crawlerFeeds = [
  ['openai-training', 'https://openai.com/gptbot.json'],
  ['openai-search', 'https://openai.com/searchbot.json'],
  ['openai-user', 'https://openai.com/chatgpt-user.json'],
  ['anthropic', 'https://claude.com/crawling/bots.json'],
  ['perplexity-search', 'https://www.perplexity.ai/perplexitybot.json'],
  ['perplexity-user', 'https://www.perplexity.ai/perplexity-user.json'],
  ['google-common', 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json'],
  ['google-special', 'https://developers.google.com/static/crawling/ipranges/special-crawlers.json'],
  ['bing', 'https://www.bing.com/toolbox/bingbot.json'],
  ['apple', 'https://search.developer.apple.com/applebot.json'],
  ['duckduckgo', 'https://duckduckgo.com/duckduckbot.json'],
  ['common-crawl', 'https://index.commoncrawl.org/ccbot.json'],
  ['ahrefs', 'https://api.ahrefs.com/v3/public/crawler-ip-ranges'],
  ['amazon', 'https://developer.amazon.com/amazonbot/ip-addresses/', 'html'],
  ['amazon-search', 'https://developer.amazon.com/amazonbot/searchbot-ip-addresses/', 'html'],
];
export const crawlerRefreshInterval = 6 * 60 * 60_000;
const retention = 30 * 24 * 60 * 60_000;
const bundledCache = new URL('../config/crawler-ip-ranges.json', import.meta.url);

export function scheduleCrawlerRefresh(list, { warn = console.warn, setIntervalFn = setInterval } = {}) {
  const refresh = () => Promise.resolve().then(() => list.refresh())
    .catch(() => warn('Crawler IP refresh failed; retaining unexpired cached ranges.'));
  void refresh();
  const timer = setIntervalFn(refresh, crawlerRefreshInterval);
  timer.unref?.();
  return timer;
}

export function compileCidrs(cidrs) {
  if (!Array.isArray(cidrs) || cidrs.length > 10_000) throw new Error('Invalid crawler CIDR list.');
  const list = new BlockList();
  for (const cidr of cidrs) {
    if (typeof cidr !== 'string') throw new Error('Invalid crawler CIDR.');
    const parts = cidr.split('/');
    const family = isIP(parts[0]);
    const width = family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? width : Number(parts[1]);
    if (!family || parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1]))
      || !Number.isInteger(prefix) || prefix < (family === 4 ? 16 : 32) || prefix > width) {
      throw new Error('Invalid or excessively broad crawler CIDR.');
    }
    list.addSubnet(parts[0], prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return address => {
    if (typeof address !== 'string' || address.includes('%')) return false;
    const ip = address.trim();
    const family = isIP(ip);
    return Boolean(family && list.check(ip, family === 4 ? 'ipv4' : 'ipv6'));
  };
}

export function parseCrawlerFeed(text, format) {
  let prefixes;
  if (format === 'html') {
    // Amazon publishes its JSON in an HTML code block. Extract only explicitly named prefix fields.
    const decoded = text.replace(/&quot;|&#34;/g, '"');
    prefixes = [...decoded.matchAll(/"(?:ipv[46]Prefix|ip_prefix)"\s*:\s*"([0-9a-fA-F:./]+)"/g)].map(match => match[1]);
  } else {
    const data = JSON.parse(text);
    if (!Array.isArray(data.prefixes)) throw new Error('Missing crawler prefixes.');
    prefixes = data.prefixes.map(entry => {
      if (!entry || typeof entry !== 'object' || Boolean(entry.ipv4Prefix) === Boolean(entry.ipv6Prefix)) throw new Error('Invalid crawler prefix.');
      return entry.ipv4Prefix ?? entry.ipv6Prefix;
    });
  }
  if (!prefixes.length) throw new Error('Empty crawler feed.');
  const cidrs = [...new Set(prefixes)];
  compileCidrs(cidrs);
  return cidrs;
}

async function fetchFeed(url, format, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept: format === 'html' ? 'text/html' : 'application/json' } });
  if (!response.ok || !response.body) throw new Error('Crawler feed unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error('Crawler feed exceeds size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return parseCrawlerFeed(Buffer.concat(chunks).toString('utf8'), format);
}

/** In-memory matcher with per-source last-known-good persistence; refresh never runs on a visitor request. */
export function createCrawlerBanlist({ extraCidrs = '', cachePath, seedPath = bundledCache, fetcher = fetch,
  now = Date.now, warn = console.warn } = {}) {
  const extra = compileCidrs(extraCidrs.split(',').map(value => value.trim()).filter(Boolean));
  const entries = new Map();
  const known = new Map(crawlerFeeds.map(([id, url]) => [id, url]));
  for (const path of [seedPath, cachePath].filter(Boolean)) {
    try {
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      for (const entry of stored.feeds ?? []) {
        if (known.get(entry.id) !== entry.url || !Number.isFinite(entry.fetched_at) || entry.fetched_at > now() + 60_000
          || now() - entry.fetched_at > retention) continue;
        if ((entries.get(entry.id)?.fetched_at ?? -Infinity) > entry.fetched_at) continue;
        try { compileCidrs(entry.cidrs); entries.set(entry.id, entry); }
        catch { warn(`Invalid cached crawler feed: ${entry.id}`); }
      }
    } catch (error) { if (error.code !== 'ENOENT') warn('Could not read crawler IP cache; using other available feeds.'); }
  }
  let matchers = [];
  let expiresAt = Infinity;
  const rebuild = () => {
    for (const [id, entry] of entries) if (now() - entry.fetched_at > retention) entries.delete(id);
    matchers = [...entries.values()].map(entry => compileCidrs(entry.cidrs));
    expiresAt = Math.min(Infinity, ...[...entries.values()].map(entry => entry.fetched_at + retention));
  };
  rebuild();
  let pending;
  let lastAttempt = -Infinity;
  const snapshot = () => ({ feeds: [...entries.values()] });
  return {
    has: address => {
      if (now() > expiresAt) rebuild();
      return extra(address) || matchers.some(matches => matches(address));
    },
    snapshot,
    refresh() {
      if (pending) return pending;
      if (now() - lastAttempt < crawlerRefreshInterval) return Promise.resolve();
      lastAttempt = now();
      pending = (async () => {
        const results = await Promise.allSettled(crawlerFeeds.map(async ([id, url, format]) => {
          const cidrs = await fetchFeed(url, format, fetcher);
          entries.set(id, { id, url, fetched_at: now(), cidrs });
        }));
        results.forEach((result, index) => { if (result.status === 'rejected') warn(`Crawler IP refresh failed: ${crawlerFeeds[index][0]}; retaining unexpired cached ranges.`); });
        rebuild();
        if (cachePath) {
          try {
            writeFileSync(`${cachePath}.tmp`, JSON.stringify(snapshot()) + '\n', { mode: 0o600 });
            renameSync(`${cachePath}.tmp`, cachePath);
          } catch { warn('Could not persist crawler IP cache; in-memory ranges remain active.'); }
        }
        return { refreshed: results.filter(result => result.status === 'fulfilled').length, total: crawlerFeeds.length };
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
