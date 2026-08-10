import express from 'express';
import db from '../db/index.js';
import audit from '../audit.js';
import { createBan } from '../bans.js';
import { requireStaff, roleAtLeast } from '../middleware/staff.js';
import { requireFreshAuth } from '../middleware/session.js';
import { ipPrefixHash } from '../util/net.js';
import { newId } from '../util/ids.js';
import * as V from '../validation.js';
import * as mail from '../mail.js';
import { isIP } from 'node:net';
const router = express.Router();
const ROLES = ['none', 'support', 'moderator', 'administrator', 'owner'];
const USER_PAGE_SIZE = 100;
function fail(res, status, message) {
  return res.status(status).render('error', { title: 'Administration', status, message });
}
function prose(value, field = 'Reason') {
  return V.proseText(value, { field, min: 3, max: 500 });
}
router.get('/admin/users', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const requestedPage = /^\d+$/.test(String(req.query.page || '')) ? Number(req.query.page) : 1;
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS count FROM users');
  const total = Number(countRows[0]?.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.signup_status, u.staff_role, u.twofa_method,
            u.email_verified_at, u.created_at, u.updated_at,
            (SELECT p.username_display
               FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
              WHERE w.owner_user_id = u.id ORDER BY p.created_at LIMIT 1) AS profile_username,
            (SELECT p.display_name
               FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
              WHERE w.owner_user_id = u.id ORDER BY p.created_at LIMIT 1) AS profile_display_name,
            (SELECT COUNT(*)
               FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
              WHERE w.owner_user_id = u.id) AS profile_count,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions
       FROM users u
      ORDER BY u.created_at DESC, u.id
      LIMIT ? OFFSET ?`,
    [Date.now(), USER_PAGE_SIZE, (page - 1) * USER_PAGE_SIZE],
  );
  res.render('admin/users', {
    title: 'User directory', users: rows, page, totalPages, total,
  });
});
router.get('/admin/accounts/:id', requireStaff('support'), requireFreshAuth(), async (req, res) => {
  const [{ rows }, sessions, profiles] = await Promise.all([
    db.query(`SELECT id, email, signup_status, staff_role, twofa_method, email_verified_at,
                    requested_at, decided_at, created_at, updated_at
               FROM users WHERE id = ?`, [req.params.id]),
    db.query(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`, [req.params.id, Date.now()]),
    db.query(`SELECT p.id, p.username_display, p.published FROM profiles p
               JOIN workspaces w ON w.id = p.workspace_id
              WHERE w.owner_user_id = ? ORDER BY p.created_at`, [req.params.id]),
  ]);
  const account = rows[0];
  if (!account) return fail(res, 404, 'Page not found.');
  res.render('admin/account-detail', {
    title: 'Account administration', account, profiles: profiles.rows,
    activeSessions: Number(sessions.rows[0]?.count || 0), roles: ROLES,
    canManageRole: req.user.staff_role === 'owner' && account.id !== req.user.id,
    canEmergency: roleAtLeast(req.user.staff_role, 'administrator') && account.id !== req.user.id,
  });
});
router.post('/admin/accounts/:id/role', requireStaff('owner'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const role = String(req.body.role || '');
  if (!ROLES.includes(role)) return fail(res, 400, 'Choose a valid staff role.');
  if (req.params.id === req.user.id) return fail(res, 403, 'Owners cannot change their own role.');
  if (req.body.confirmation !== 'CHANGE STAFF ROLE') return fail(res, 400, 'Type CHANGE STAFF ROLE exactly to continue.');
  const { rows } = await db.query('SELECT id, email, staff_role, signup_status FROM users WHERE id = ?', [req.params.id]);
  const target = rows[0];
  if (!target) return fail(res, 404, 'Page not found.');
  if (target.signup_status !== 'approved' && role !== 'none') return fail(res, 409, 'Only approved accounts may receive staff access.');
  await db.query('UPDATE users SET staff_role = ?, updated_at = ? WHERE id = ?', [role, Date.now(), target.id]);
  await audit.record({ type: 'staff.role_changed', actorUserId: req.user.id, subjectUserId: target.id, ipHash: ipPrefixHash(req), detail: { from: target.staff_role, to: role } });
  mail.securityNotice(target.email, `Your staff role changed from ${target.staff_role} to ${role}.`).catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
});
router.post('/admin/accounts/:id/revoke-sessions', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  if (req.params.id === req.user.id) return fail(res, 403, 'Use account security to manage your own sessions.');
  if (req.body.confirmation !== 'REVOKE ALL SESSIONS') return fail(res, 400, 'Type REVOKE ALL SESSIONS exactly to continue.');
  const { rows } = await db.query('SELECT id, email, staff_role FROM users WHERE id = ?', [req.params.id]);
  const target = rows[0];
  if (!target) return fail(res, 404, 'Page not found.');
  if (roleAtLeast(target.staff_role, 'administrator') && req.user.staff_role !== 'owner') return fail(res, 403, 'Only an Owner may take emergency action against Administrator or Owner staff.');
  const now = Date.now();
  await db.batch([
    { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, target.id] },
    { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [target.id] },
    { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [target.id] },
  ]);
  await audit.record({ type: 'account.sessions_emergency_revoked', actorUserId: req.user.id, subjectUserId: target.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(target.email, 'An Administrator revoked every active session and pending sign-in challenge for your account.').catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
});
router.get('/admin/bans', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(`SELECT id, target_type, target_hash, scope, reason, created_at, expires_at, lifted_at
                                     FROM bans ORDER BY created_at DESC LIMIT 200`);
  res.render('admin/bans', { title: 'Ban management', bans: rows });
});
router.post('/admin/bans', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/bans' }), async (req, res) => {
  const type = String(req.body.target_type || '');
  const scope = String(req.body.scope || '');
  const value = String(req.body.target || '').trim();
  if (!['user', 'email', 'domain', 'ip', 'cidr'].includes(type) || !['account', 'viewing', 'both'].includes(scope) || !value) return fail(res, 400, 'Choose a valid target and scope.');
  if (type === 'email') {
    try { V.email(value); } catch { return fail(res, 400, 'Enter a valid email target.'); }
  }
  if (type === 'domain' && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value.replace(/^@/, ''))) return fail(res, 400, 'Enter a valid domain target.');
  if (type === 'ip' && !isIP(value)) return fail(res, 400, 'Enter a valid IP target.');
  if (type === 'cidr') {
    const [network, prefix, extra] = value.split('/');
    const family = isIP(network); const bits = Number(prefix);
    if (extra !== undefined || !family || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) return fail(res, 400, 'Enter a valid CIDR target.');
  }
  if (req.body.confirmation !== 'CREATE BAN') return fail(res, 400, 'Type CREATE BAN exactly to continue.');
  let reason;
  try { reason = prose(req.body.reason); } catch (error) { if (error instanceof V.ValidationError) return fail(res, 400, error.message); throw error; }
  let expiresAt = null;
  if (req.body.duration_days) {
    const days = Number(req.body.duration_days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return fail(res, 400, 'Duration must be 1 to 3650 days.');
    expiresAt = Date.now() + days * 86400000;
  }
  try { await createBan({ type, value, scope, reason, createdBy: req.user.id, expiresAt }); }
  catch { return fail(res, 400, 'The ban target is invalid.'); }
  let notificationAddress = type === 'email' ? value : null;
  if (type === 'user') notificationAddress = (await db.query('SELECT email FROM users WHERE id = ?', [value])).rows[0]?.email || null;
  if (notificationAddress) mail.securityNotice(notificationAddress, `An Administrator applied a ${scope} ban to your account or address.`).catch(() => {});
  res.redirect('/admin/bans');
});
router.post('/admin/bans/:id/lift', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/bans' }), async (req, res) => {
  if (req.body.confirmation !== 'LIFT BAN') return fail(res, 400, 'Type LIFT BAN exactly to continue.');
  let reason;
  try { reason = prose(req.body.reason); } catch (error) { if (error instanceof V.ValidationError) return fail(res, 400, error.message); throw error; }
  const now = Date.now();
  const result = await db.query('UPDATE bans SET lifted_at = ? WHERE id = ? AND lifted_at IS NULL', [now, req.params.id]);
  if (!result.rowCount) return fail(res, 409, 'That ban is no longer active.');
  await audit.record({ type: 'ban.lifted', actorUserId: req.user.id, target: req.params.id, ipHash: ipPrefixHash(req), detail: { reason } });
  res.redirect('/admin/bans');
});
router.get('/admin/email-rules', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query('SELECT id, domain, rule_type, source, created_at FROM email_domain_rules ORDER BY domain');
  res.render('admin/email-rules', { title: 'Email-domain rules', rules: rows });
});
router.post('/admin/email-rules', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/email-rules' }), async (req, res) => {
  const domain = String(req.body.domain || '').trim().toLowerCase().replace(/^@/, '');
  const ruleType = String(req.body.rule_type || '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || !['disposable', 'allowlist', 'blocklist'].includes(ruleType)) return fail(res, 400, 'Enter a valid domain and rule type.');
  if (req.body.confirmation !== 'ADD EMAIL RULE') return fail(res, 400, 'Type ADD EMAIL RULE exactly to continue.');
  try { await db.query('INSERT INTO email_domain_rules (id, domain, rule_type, source, created_at) VALUES (?, ?, ?, ?, ?)', [newId(), domain, ruleType, 'operator', Date.now()]); }
  catch { return fail(res, 409, 'A rule already exists for that domain.'); }
  await audit.record({ type: 'email_domain_rule.created', actorUserId: req.user.id, target: domain, ipHash: ipPrefixHash(req), detail: { ruleType } });
  res.redirect('/admin/email-rules');
});
router.post('/admin/email-rules/:id/delete', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/email-rules' }), async (req, res) => {
  if (req.body.confirmation !== 'DELETE EMAIL RULE') return fail(res, 400, 'Type DELETE EMAIL RULE exactly to continue.');
  const { rows } = await db.query('SELECT id, domain, rule_type FROM email_domain_rules WHERE id = ?', [req.params.id]);
  if (!rows[0]) return fail(res, 404, 'Page not found.');
  await db.query('DELETE FROM email_domain_rules WHERE id = ?', [req.params.id]);
  await audit.record({ type: 'email_domain_rule.deleted', actorUserId: req.user.id, target: rows[0].domain, ipHash: ipPrefixHash(req), detail: { ruleType: rows[0].rule_type } });
  res.redirect('/admin/email-rules');
});
router.get('/admin/audit', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const eventType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  if (eventType.length > 100 || subject.length > 100) return fail(res, 400, 'Audit filters are too long.');
  const clauses = []; const params = [];
  if (eventType) { clauses.push('event_type = ?'); params.push(eventType); }
  if (subject) { clauses.push('subject_user_id = ?'); params.push(subject); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT id, event_type, actor_user_id, subject_user_id, target, detail, created_at FROM audit_events ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.render('admin/audit', { title: 'Audit log', events: rows, eventType, subject });
});
router.get('/admin/reports', requireStaff('moderator'), requireFreshAuth(), async (req, res) => {
  const queries = await Promise.all([
    db.query("SELECT COUNT(*) AS count FROM users WHERE signup_status = 'pending'"),
    db.query("SELECT COUNT(*) AS count FROM content_flags WHERE status = 'pending'"),
    db.query("SELECT COUNT(*) AS count FROM content_suspensions WHERE status IN ('pending', 'extended') AND active_user_key IS NOT NULL"),
    db.query("SELECT COUNT(*) AS count FROM recovery_cases WHERE status = 'pending'"),
    db.query('SELECT COUNT(*) AS count FROM bans WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)', [Date.now()]),
  ]);
  res.render('admin/reports', { title: 'Operational reports', counts: queries.map((q) => Number(q.rows[0]?.count || 0)) });
});
export default router;
