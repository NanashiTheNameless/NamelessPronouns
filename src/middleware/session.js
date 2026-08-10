import db from '../db/index.js';
import { loadSession, destroyBySessionId, clearSessionCookie } from '../auth/session.js';
import { matchAccountBan } from '../bans.js';
import { clientIp } from '../util/net.js';
import audit from '../audit.js';
import { isFresh, safeNextPath } from '../auth/reauth.js';
async function fetchUser(userId) {
  const { rows } = await db.query(
    'SELECT id, email, staff_role, signup_status, twofa_method, email_verified_at, avatar_source, avatar_data_uri FROM users WHERE id = ?',
    [userId],
  );
  return rows[0] || null;
}
export function sessionMiddleware() {
  return async (req, res, next) => {
    try {
      req.session = null;
      req.user = null;
      const session = await loadSession(req);
      if (!session) return next();
      const user = await fetchUser(session.user_id);
      if (!user) {
        await destroyBySessionId(session.id);
        clearSessionCookie(res);
        return next();
      }
      const ban = await matchAccountBan({ userId: user.id, email: user.email, ip: clientIp(req) });
      if (ban) {
        await destroyBySessionId(session.id);
        clearSessionCookie(res);
        await audit.record({ type: 'ban.session_revoked', subjectUserId: user.id, target: ban.id });
        return next();
      }
      req.session = session;
      req.user = user;
      const deletion = await db.query(
        "SELECT id, requested_at, purge_after FROM deletion_requests WHERE user_id = ? AND status IN ('pending', 'held') AND active_user_key = ?",
        [user.id, user.id],
      );
      req.deletionRequest = deletion.rows[0] || null;
      res.locals.user = user;
      res.locals.deletionRequest = req.deletionRequest;
      res.locals.csrfToken = session.csrf_token;
      next();
    } catch (err) {
      next(err);
    }
  };
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}
export function requireApproved(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.signup_status !== 'approved') {
    return res.status(403).render('error', { title: 'Pending', status: 403, message: 'Your account is not yet approved.' });
  }
  if (req.session?.restricted) {
    return res.redirect('/account/suspended');
  }
  next();
}
export function requireFreshAuth(options = {}) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (isFresh(req.session)) return next();
    const returnTo = options.returnTo || (req.method === 'GET' ? req.originalUrl : '/settings');
    const query = new URLSearchParams({ next: safeNextPath(returnTo) }).toString();
    return res.redirect(`/account/reauth?${query}`);
  };
}
