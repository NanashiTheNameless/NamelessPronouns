const EXACT = new Set([
  '/account/deletion', '/account/reauth', '/logout', '/consent', '/terms',
  '/privacy', '/contact', '/recover', '/legal-requests', '/acknowledgements',
]);
const PREFIX = ['/account/deletion', '/account/reauth', '/login', '/static/'];
export function deletionSessionGate() {
  return (req, res, next) => {
    if (!req.deletionRequest) return next();
    if (EXACT.has(req.path) || PREFIX.some((prefix) => req.path.startsWith(prefix))) return next();
    return res.redirect('/account/deletion');
  };
}
