import { escapeHtml } from './util/html.js';
import { ROBOTS_DIRECTIVES } from './middleware/security-headers.js';

export const mazeRoot = '/reference-archive';
const generatorOrigin = 'http://archive.invalid';

function plainText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|#39);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
  })[entity]).replace(/\s+/g, ' ').trim();
}

/** Like the order system, expose only inert paragraphs and encoded local links. */
export function extractMazeContent(html) {
  const main = /<main\b[^>]*>([\s\S]*?)(?:<\/main\s*>|$)/i.exec(html)?.[1] ?? html;
  const prose = main.split(/<(?:nav|footer|aside)\b/i, 1)[0];
  // Iocaine's minified HTML may omit paragraph end tags and attribute quotes.
  const paragraphs = [...prose.matchAll(/<p\b[^>]*>([\s\S]*?)(?=<\/p\s*>|<p\b|<\/?(?:div|main|nav|ul|ol|h[1-6]|section|footer)\b|$)/gi)]
    .slice(0, 12).map(match => plainText(match[1]).slice(0, 1200));
  const links = [];
  for (const match of main.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (!href || href.startsWith('//') || /[\\\r\n]/.test(href)) continue;
    let url;
    try { url = new URL(href.replaceAll('&amp;', '&'), generatorOrigin); } catch { continue; }
    if (url.origin !== generatorOrigin || url.pathname.length > 900) continue;
    const token = Buffer.from(url.pathname).toString('base64url');
    links.push({ href: `${mazeRoot}/entry/${token}`, text: plainText(match[4]).slice(0, 150) || 'Related reference' });
    if (links.length >= 24) break;
  }
  if (!paragraphs.some(Boolean) || !links.length) throw new Error('Generator did not return a maze.');
  return { paragraphs, links };
}

export function mazeGeneratorPath(publicPath) {
  if (!publicPath.startsWith(`${mazeRoot}/entry/`)) return '/';
  const token = new RegExp(`^${mazeRoot}/entry/([A-Za-z0-9_-]{1,1200})/?$`).exec(publicPath)?.[1];
  if (!token) return null;
  const path = Buffer.from(token, 'base64url').toString('utf8');
  if (Buffer.from(path).toString('base64url') !== token || !path.startsWith('/') || path.startsWith('//')
    || /[\s\\?#\u0000-\u001f\u007f]/.test(path) || path.length > 900) return null;
  return path;
}

export function renderMazeContent(content) {
  const paragraphs = content.paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('');
  const links = content.links.map(link => `<li><a href="${escapeHtml(link.href)}" rel="nofollow">${escapeHtml(link.text)}</a></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="${ROBOTS_DIRECTIVES}"><title>Reference archive</title></head><body><main><h1>Reference archive</h1>${paragraphs}<nav aria-label="Related references"><ul>${links}</ul></nav></main></body></html>`;
}
