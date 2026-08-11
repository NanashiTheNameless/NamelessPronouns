import { randomBytes } from 'node:crypto';

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://www.gravatar.com",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
];
function nonceFor(res) {
  if (!res.locals.cspNonce) res.locals.cspNonce = randomBytes(16).toString('base64');
  return res.locals.cspNonce;
}
function cspFor(res, { rum = false } = {}) {
  const nonce = nonceFor(res);
  return BASE_CSP.map((directive) => {
    if (directive.startsWith('script-src')) {
      return `${directive} 'nonce-${nonce}'${rum ? ` ${RUM_SCRIPT}` : ''}`;
    }
    if (rum && directive.startsWith('connect-src')) return `${directive} ${RUM_CONNECT}`;
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
  res.setHeader('Content-Security-Policy', cspFor(res, { rum: true }));
  res.setHeader('X-Robots-Tag', ROBOTS_DIRECTIVES);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
