const ALLOWED_EXACT = new Set([
  '/account/password-reset-required', '/logout', '/consent', '/terms', '/privacy',
  '/contact', '/legal-requests', '/acknowledgements', '/supporters', '/altcha/challenge',
]);
const ALLOWED_PREFIX = ['/static/', '/login', '/forgot-password', '/account/password-reset-required'];
export function passwordResetGate() {
  return (req, res, next) => {
    if (!req.user?.password_reset_required_at) return next();
    if (ALLOWED_EXACT.has(req.path) || ALLOWED_PREFIX.some((prefix) => req.path.startsWith(prefix))) return next();
    return res.redirect('/account/password-reset-required');
  };
}
