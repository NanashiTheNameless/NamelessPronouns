import { hasAccepted } from '../policy.js';
import { setConsentReturn } from '../consent-return.js';
const EXEMPT_EXACT = new Set(['/consent', '/terms', '/privacy', '/legal-requests', '/contact', '/acknowledgements', '/recover', '/altcha/challenge']);
const EXEMPT_PREFIX = ['/static/'];
const SENSITIVE_RETURN_PREFIX = ['/account/export/download/'];
function isExempt(path) {
  if (EXEMPT_EXACT.has(path)) return true;
  return EXEMPT_PREFIX.some((p) => path.startsWith(p));
}
export function policyGate() {
  return (req, res, next) => {
    if (isExempt(req.path)) return next();
    if (hasAccepted(req)) return next();
    if (SENSITIVE_RETURN_PREFIX.some((prefix) => req.path.startsWith(prefix))) {
      setConsentReturn(res, req.originalUrl);
      return res.redirect('/consent');
    }
    const target = req.method === 'GET' && req.path !== '/' ? `?next=${encodeURIComponent(req.path)}` : '';
    return res.redirect(`/consent${target}`);
  };
}
