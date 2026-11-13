import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ROBOTS_DIRECTIVES } from './security-headers.js';
import { mazeRoot, mazeGeneratorPath, extractMazeContent, renderMazeContent } from '../bot-maze.js';

export { mazeRoot };
// A request-only opt-in for testing: changing the user agent back undoes it.
const selfTestAgent = /(?:^|\s)Tarpit-Test(?:\/[0-9.]+)?(?=\s|$)/i;
// Match crawler identities, not tools also used by people (curl, text browsers,
// browser automation for accessibility/tests), or device names such as CUBOT.
const crawlerAgent = /\b(?:GPTBot|OAI-SearchBot|OAI-AdsBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|Claude-Agent|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|GoogleOther|Googlebot|Google-CloudVertexBot|GoogleAgent-Mariner|Bingbot|bingpreview|DuckDuckBot|DuckAssistBot|Applebot(?:-Extended)?|Amazonbot|Amzn-SearchBot|Amzn-User|Bytespider|CCBot|Diffbot|cohere-ai|cohere-training-data-crawler|AI2Bot|Meta-ExternalAgent|Meta-ExternalFetcher|facebookexternalhit|YandexBot|Baiduspider|PetalBot|SemrushBot|AhrefsBot|AhrefsSiteAudit|DataForSeoBot|Firecrawl|Scrapy|crawler|spider|scraper)\b/i;

function upstreamUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') {
    throw new Error('IOCAINE_URL must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  return url;
}

export function botClientIp(req, trustCloudflare = false) {
  // This opt-in requires a private origin accessible exclusively through Tunnel.
  // req.ip / X-Forwarded-For are deliberately not used for bot classification.
  const address = trustCloudflare ? req.get('cf-connecting-ip') : req.socket.remoteAddress;
  return typeof address === 'string' && !address.includes('%') && isIP(address) ? address : '';
}

function fallbackPage() {
  const ids = Array.from({ length: 24 }, () => randomBytes(8).toString('hex'));
  const paragraphs = ids.slice(0, 8).map(id => `<p>The amber compass follows the copper ledger. A quartz lantern indexes the ribbon chamber in sequence ${id}.</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="${ROBOTS_DIRECTIVES}"><title>Reference archive</title></head><body><main><h1>Reference archive</h1>${paragraphs}<nav aria-label="Related references"><ul>${ids.map(id => `<li><a href="${mazeRoot}/${id}/" rel="nofollow">Reference ${id}</a></li>`).join('')}</ul></nav></main></body></html>`;
}

async function readDecoy(response) {
  if (response.status !== 200 || !response.body || !/^text\/html\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error('Iocaine did not return an HTML decoy.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw new Error('Iocaine response exceeds size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (!bytes) throw new Error('Iocaine returned an empty decoy.');
  return Buffer.concat(chunks).toString('utf8');
}

/** Runs before static files, cookies, sessions, body parsing and database work. */
export function botDefense({ config, banlist, fetcher = fetch, waitMs = 250,
  timeoutMs = 5000, maxActive = 16, now = Date.now } = {}) {
  const upstream = upstreamUrl(config.IOCAINE_URL);
  let active = 0;
  let retryAt = 0;
  return async (req, res, next) => {
    const enabled = config.BOT_DEFENSE_ENABLED;
    res.locals.botTrapEnabled = enabled && config.BOT_TRAP_ENABLED;
    if (!enabled) return next();
    const path = req.path;
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && ['/robots.txt', '/healthz', '/readyz'].includes(path)) return next();
    const maze = path === mazeRoot || path.startsWith(`${mazeRoot}/`);
    const bot = banlist.has(botClientIp(req, config.BOT_TRUST_CLOUDFLARE))
      || selfTestAgent.test(req.get('user-agent') || '')
      || crawlerAgent.test(req.get('user-agent') || '')
      || Boolean(req.get('signature-agent') || req.get('sec-web-bot-auth'))
      || /\btag\s*=\s*"?web-bot-auth\b/i.test(req.get('signature-input') || '');
    if (!maze && !bot) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', '*');
    if (maze && !config.BOT_TRAP_ENABLED) return res.status(404).type('text/plain').send('Not found.\n');
    if (!read) {
      if (maze) res.setHeader('Allow', 'GET, HEAD');
      return res.status(maze ? 405 : 403).type('text/plain').send('Automated access is not allowed.\n');
    }
    if (!config.BOT_TRAP_ENABLED) return res.status(403).type('text/plain').send('Automated access is not allowed.\n');
    res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (req.method === 'HEAD') return res.status(200).type('html').end();
    if (active >= maxActive) {
      res.setHeader('Retry-After', '30');
      return res.status(429).type('text/plain').send('Try again later.\n');
    }
    active++;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      await delay(waitMs, undefined, { signal: controller.signal });
      let html;
      const generatorPath = mazeGeneratorPath(path);
      if (upstream && generatorPath && now() >= retryAt) {
        try {
          const url = new URL(upstream);
          // Never send profile/account paths, query tokens, cookies, auth headers,
          // or caller-controlled decision headers to the decoy service.
          url.pathname = generatorPath;
          const response = await fetcher(url, {
            redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
            headers: { accept: 'text/html', 'user-agent': 'NamelessPronouns-Archive', 'iocaine-decision': 'garbage' },
          });
          html = renderMazeContent(extractMazeContent(await readDecoy(response)));
        } catch {
          // Short circuit outages so each bot request does not wait on a dead service.
          retryAt = now() + 30_000;
        }
      }
      if (!res.destroyed) res.status(200).type('html').send(html || fallbackPage());
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally {
      res.off('close', cancel);
      active--;
    }
  };
}
