import db from './db/index.js';
import config from './config.js';
import logger from './logger.js';
let communityCache = new Set();
let lastRefresh = 0;
function domainOf(email) {
  const at = String(email).lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}
export function matchesEmailDomain(domain, domains) {
  const normalized = String(domain).trim().toLowerCase();
  return [...domains].some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`));
}
async function dbDomains(ruleType) {
  const { rows } = await db.query('SELECT domain FROM email_domain_rules WHERE rule_type = ?', [ruleType]);
  return rows.map((r) => r.domain.toLowerCase());
}
export async function refreshCommunityList({ now = Date.now() } = {}) {
  if (!config.DISPOSABLE_LIST_ENABLED || !config.DISPOSABLE_LIST_URL) return;
  try {
    const res = await fetch(config.DISPOSABLE_LIST_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const next = new Set(
      text
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l && !l.startsWith('#')),
    );
    if (next.size > 0) {
      communityCache = next;
      lastRefresh = now;
      logger.info('disposable list refreshed', { count: next.size });
    }
  } catch (err) {
    logger.warn('disposable list refresh failed; keeping cache', { error: err.message, cached: communityCache.size });
  }
}
export function scheduleCommunityRefresh() {
  if (!config.DISPOSABLE_LIST_ENABLED || !config.DISPOSABLE_LIST_URL) return null;
  refreshCommunityList().catch(() => {});
  const handle = setInterval(() => refreshCommunityList().catch(() => {}), config.DISPOSABLE_REFRESH_HOURS * 3600 * 1000);
  handle.unref?.();
  return handle;
}
export async function evaluateEmailDomain(email) {
  const domain = domainOf(email);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false };
  if (config.EMAIL_DOMAIN_ALLOWLIST_ENABLED) {
    const allow = new Set([...config.EMAIL_DOMAIN_ALLOWLIST, ...(await dbDomains('allowlist'))]);
    return { ok: matchesEmailDomain(domain, allow) };
  }
  const denied = new Set([
    ...config.DISPOSABLE_EMAIL_DOMAINS,
    ...communityCache,
    ...(await dbDomains('disposable')),
    ...(await dbDomains('blocklist')),
  ]);
  return { ok: !matchesEmailDomain(domain, denied) };
}
