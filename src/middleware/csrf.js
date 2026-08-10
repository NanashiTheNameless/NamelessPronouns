import { safeEqual } from '../util/crypto.js';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function csrfProtection() {
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost && host && originHost !== host) {
        return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Cross-site request blocked.' });
      }
    }
    if (req.session) {
      const provided = req.body?._csrf || req.headers['x-csrf-token'];
      if (!provided || !safeEqual(provided, req.session.csrf_token)) {
        return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Invalid form token. Reload and try again.' });
      }
    }
    next();
  };
}
