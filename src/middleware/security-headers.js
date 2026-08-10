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
export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', BASE_CSP.join('; '));
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
  const csp = BASE_CSP.map((d) => {
    if (d.startsWith('script-src')) return `${d} ${RUM_SCRIPT}`;
    if (d.startsWith('connect-src')) return `${d} ${RUM_CONNECT}`;
    return d;
  });
  res.setHeader('Content-Security-Policy', csp.join('; '));
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
