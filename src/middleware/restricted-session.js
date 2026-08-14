const ALLOWED_EXACT = new Set([
  '/account/suspended', '/consent', '/terms', '/privacy', '/contact',
  '/legal-requests', '/acknowledgements', '/supporters', '/recover', '/logout', '/altcha/challenge',
]);
const ALLOWED_PREFIX = ['/static/', '/account/content-flags', '/login'];
export function restrictedSessionGate() {
  return (req, res, next) => {
    if (!req.session?.restricted) return next();
    if (ALLOWED_EXACT.has(req.path) || ALLOWED_PREFIX.some((prefix) => req.path.startsWith(prefix))) return next();
    return res.redirect('/account/suspended');
  };
}
