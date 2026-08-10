const ORDER = ['none', 'support', 'moderator', 'administrator', 'owner'];
const LABELS = Object.freeze({
  support: 'Support',
  moderator: 'Moderator',
  administrator: 'Administrator',
  owner: 'Owner',
});
export function roleAtLeast(role, min) {
  return ORDER.indexOf(role) >= ORDER.indexOf(min);
}
export function staffRoleLabel(role) {
  return LABELS[role] || null;
}
export function requireStaff(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.session?.restricted) return res.redirect('/account/suspended');
    if (req.user.signup_status !== 'approved' || !roleAtLeast(req.user.staff_role, minRole)) {
      return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
    }
    next();
  };
}
