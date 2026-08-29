import { hasAccepted, hasStoredAcceptance } from '../policy.js';
import { setConsentReturn } from '../consent-return.js';
const EXEMPT_EXACT = new Set([
  '/consent', '/terms', '/privacy', '/legal-requests', '/contact', '/acknowledgements', '/supporters',
  '/recover', '/altcha/challenge', '/teapot', '/humans.txt', '/robots.txt',
  '/.well-known/nameless', '/404', '/nothing',
]);
const EXEMPT_PREFIX = ['/static/'];
const SENSITIVE_RETURN_PREFIX = ['/account/export/download/'];
function isExempt(path) {
  if (EXEMPT_EXACT.has(path)) return true;
  return EXEMPT_PREFIX.some((p) => path.startsWith(p));
}
export function policyGate() {
  return async (req, res, next) => {
    if (isExempt(req.path)) return next();
    if (hasAccepted(req) && (!req.user || await hasStoredAcceptance(req.user.id))) return next();
    if (SENSITIVE_RETURN_PREFIX.some((prefix) => req.path.startsWith(prefix))) {
      setConsentReturn(res, req.originalUrl);
      return res.redirect('/consent');
    }
    const target = req.method === 'GET' && req.path !== '/' ? `?next=${encodeURIComponent(req.path)}` : '';
    return res.redirect(`/consent${target}`);
  };
}
