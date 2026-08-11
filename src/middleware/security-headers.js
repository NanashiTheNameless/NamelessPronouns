import { randomBytes } from 'node:crypto';

const GRAVATAR = 'https://www.gravatar.com';
const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' data: ${GRAVATAR}`,
  "media-src 'self' data:",
  "frame-src 'none'",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
];
const ORIGIN_LIMIT = 24;
function nonceFor(res) {
  if (!res.locals.cspNonce) res.locals.cspNonce = randomBytes(16).toString('base64');
  return res.locals.cspNonce;
}
function originList(origins) {
  if (!origins) return [];
  return [...new Set([...origins])]
    .filter((origin) => /^https:\/\/[A-Za-z0-9.-]+(?::443)?$/.test(origin))
    .sort()
    .slice(0, ORIGIN_LIMIT);
}
function cspFor(res, { rum = false, embedded = {} } = {}) {
  const nonce = nonceFor(res);
  const images = originList(embedded.images);
  const media = originList(embedded.media);
  const frames = originList(embedded.frames);
  return BASE_CSP.map((directive) => {
    if (directive.startsWith('script-src')) {
      return `${directive} 'nonce-${nonce}'${rum ? ` ${RUM_SCRIPT}` : ''}`;
    }
    if (rum && directive.startsWith('connect-src')) return `${directive} ${RUM_CONNECT}`;
    if (images.length && directive.startsWith('img-src')) return `${directive} ${images.join(' ')}`;
    if (media.length && directive.startsWith('media-src')) return `${directive} ${media.join(' ')}`;
    if (frames.length && directive.startsWith('frame-src')) return `frame-src ${frames.join(' ')}`;
    return directive;
  }).join('; ');
}
export const ROBOTS_DIRECTIVES = 'none, noindex, noarchive, nofollow, noimageindex, nosnippet';
export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', cspFor(res));
  res.setHeader('X-Robots-Tag', ROBOTS_DIRECTIVES);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  );
  res.removeHeader('X-Powered-By');
  next();
}
const RUM_SCRIPT = 'https://static.cloudflareinsights.com';
const RUM_CONNECT = "'self'";
export function publicPageHeaders(req, res, next) {
  res.locals.publicPage = true;
  res.setHeader('Content-Security-Policy', cspFor(res, { rum: true }));
  res.setHeader('X-Robots-Tag', ROBOTS_DIRECTIVES);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
export function allowEmbeddedOrigins(res, embedded, { permitted = false } = {}) {
  if (permitted !== true) return false;
  const images = originList(embedded?.images);
  const media = originList(embedded?.media);
  const frames = originList(embedded?.frames);
  if (!images.length && !media.length && !frames.length) return false;
  res.setHeader('Content-Security-Policy', cspFor(res, {
    rum: res.locals.publicPage === true,
    embedded: { images, media, frames },
  }));
  return true;
}
export { cspFor };
