import { obfuscate } from 'altcha-lib/obfuscation';
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EXACT_EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
async function payloadFor(email) {
  const normalized = String(email).trim();
  if (!EXACT_EMAIL.test(normalized)) throw new Error('Cannot obfuscate an invalid email address.');
  if (!cache.has(normalized)) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    const pending = obfuscate(`mailto:${normalized}`, { counterMin: 50, counterMax: 200 });
    cache.set(normalized, pending);
    pending.catch(() => cache.delete(normalized));
  }
  return cache.get(normalized);
}
export async function obfuscateEmail(email) {
  if (!email) return '';
  const payload = await payloadFor(email);
  return `<altcha-widget class="email-obfuscation" data-obfuscated="${escapeHtml(payload)}" display="floating" configuration='{"hideFooter":true,"hideLogo":true}'><button type="button" class="email-reveal" aria-label="Reveal email address">click to reveal</button></altcha-widget>`;
}
export async function obfuscateEmails(text) {
  const value = String(text ?? '');
  const matches = [...value.matchAll(EMAIL_PATTERN)];
  if (!matches.length) return escapeHtml(value);
  let output = '';
  let offset = 0;
  for (const match of matches) {
    output += escapeHtml(value.slice(offset, match.index));
    output += await obfuscateEmail(match[0]);
    offset = match.index + match[0].length;
  }
  return output + escapeHtml(value.slice(offset));
}
