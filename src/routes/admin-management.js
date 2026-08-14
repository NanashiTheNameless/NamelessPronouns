import express from 'express';
import db from '../db/index.js';
import audit from '../audit.js';
import { createBan, targetHash } from '../bans.js';
import { requireStaff, roleAtLeast } from '../middleware/staff.js';
import { requireFreshAuth } from '../middleware/session.js';
import { ipPrefixHash } from '../util/net.js';
import { newId } from '../util/ids.js';
import { firstProfileStatements, profileLimitFor } from '../profiles.js';
import { DELETION_GRACE_MS, purgeDeletion } from '../maintenance.js';
import * as V from '../validation.js';
import * as mail from '../mail.js';
import config from '../config.js';
import { isIP } from 'node:net';
const router = express.Router();
const ROLES = ['none', 'support', 'moderator', 'administrator', 'owner'];
const SIGNUP_STATUSES = ['pending', 'approved', 'denied', 'terminated'];
const BAN_SCOPES = ['account', 'viewing', 'both'];
const STATE_NOTICES = {
  pending: 'An Administrator returned your account to the pending queue. Access stays limited until a decision is recorded.',
  approved: 'An Administrator approved your account. Sign in to finish setting it up.',
  denied: 'An Administrator denied your account request.',
  terminated: 'An Administrator terminated your account. Every active session was ended.',
};
const USER_PAGE_SIZE = 100;
const SIGNUP_PAGE_SIZE = 25;
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
            (SELECT p.username_display FROM profiles p
              WHERE p.owner_user_id = u.id ORDER BY p.created_at LIMIT 1) AS profile_username,
            (SELECT p.display_name FROM profiles p
              WHERE p.owner_user_id = u.id ORDER BY p.created_at LIMIT 1) AS profile_display_name,
            (SELECT COUNT(*) FROM profiles p WHERE p.owner_user_id = u.id) AS profile_count,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions,
            (SELECT d.status FROM deletion_requests d
              WHERE d.user_id = u.id AND d.status IN ('pending', 'held')
              ORDER BY d.requested_at DESC LIMIT 1) AS deletion_status,
            (SELECT d.purge_after FROM deletion_requests d
              WHERE d.user_id = u.id AND d.status IN ('pending', 'held')
              ORDER BY d.requested_at DESC LIMIT 1) AS deletion_purge_after
       FROM users u
      ORDER BY u.created_at DESC, u.id
      LIMIT ? OFFSET ?`,
    [Date.now(), USER_PAGE_SIZE, (page - 1) * USER_PAGE_SIZE],
  );
  res.render('admin/users', {
    title: 'User directory', users: rows, page, totalPages, total,
  });
});
router.get('/admin/signups', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const requestedPage = /^\d+$/.test(String(req.query.page || '')) ? Number(req.query.page) : 1;
  const { rows: countRows } = await db.query("SELECT COUNT(*) AS count FROM users WHERE signup_status = 'pending'");
  const total = Number(countRows[0]?.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / SIGNUP_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const [pending, decided] = await Promise.all([
    db.query(
      `SELECT u.id, u.email, u.email_verified_at, u.requested_profile_username,
              u.requested_profile_username_display, u.requested_display_name,
              u.request_note, u.requested_at, u.created_at, u.twofa_method,
              u.signup_ip_prefix_hash,
              (SELECT pa.terms_version FROM policy_acceptances pa
                WHERE pa.user_id = u.id ORDER BY pa.accepted_at DESC LIMIT 1) AS terms_version,
              (SELECT pa.privacy_version FROM policy_acceptances pa
                WHERE pa.user_id = u.id ORDER BY pa.accepted_at DESC LIMIT 1) AS privacy_version,
              (SELECT pa.age_18_attested_at FROM policy_acceptances pa
                WHERE pa.user_id = u.id ORDER BY pa.accepted_at DESC LIMIT 1) AS age_18_attested_at,
              (SELECT pc.state FROM public_username_claims pc
                WHERE pc.pending_user_id = u.id LIMIT 1) AS claim_state
         FROM users u
        WHERE u.signup_status = 'pending'
        ORDER BY u.requested_at ASC, u.id
        LIMIT ? OFFSET ?`,
      [SIGNUP_PAGE_SIZE, (page - 1) * SIGNUP_PAGE_SIZE],
    ),
    db.query(
      `SELECT u.id, u.email, u.signup_status, u.requested_profile_username_display,
              u.requested_display_name, u.decided_at, u.decision_note,
              d.email AS decided_by_email
         FROM users u LEFT JOIN users d ON d.id = u.decided_by
        WHERE u.signup_status IN ('approved', 'denied') AND u.decided_at IS NOT NULL
        ORDER BY u.decided_at DESC
        LIMIT 25`,
    ),
  ]);
  res.render('admin/signups', {
    title: 'Signup requests',
    pending: pending.rows.map(({ signup_ip_prefix_hash: ipHash, ...row }) => ({
      ...row,
      hasSignupIp: Boolean(ipHash),
    })),
    decided: decided.rows,
    page,
    totalPages,
    total,
    selfId: req.user.id,
  });
});
function protectedTarget(actor, target) {
  return roleAtLeast(target.staff_role, 'administrator') && actor.staff_role !== 'owner';
}
async function actionableTarget(req, res, { confirmation }) {
  if (req.params.id === req.user.id) {
    fail(res, 403, 'Staff cannot action their own account.');
    return null;
  }
  if (req.body.confirmation !== confirmation) {
    fail(res, 400, `Type ${confirmation} exactly to continue.`);
    return null;
  }
  const { rows } = await db.query(
    `SELECT id, email, signup_status, staff_role, requested_profile_username,
            requested_profile_username_display, requested_display_name
       FROM users WHERE id = ?`,
    [req.params.id],
  );
  const target = rows[0];
  if (!target) {
    fail(res, 404, 'Page not found.');
    return null;
  }
  if (protectedTarget(req.user, target)) {
    fail(res, 403, 'Only an Owner may action Administrator or Owner staff.');
    return null;
  }
  return target;
}
router.get('/admin/accounts/:id', requireStaff('support'), requireFreshAuth(), async (req, res) => {
  const now = Date.now();
  const [{ rows }, sessions, profiles, bans, deletions] = await Promise.all([
    db.query(`SELECT id, email, signup_status, staff_role, twofa_method, email_verified_at,
                    requested_profile_username_display, requested_display_name, request_note,
                    requested_at, decided_at, decision_note, decision_reason_public,
                    signup_ip_prefix_hash, profile_limit, created_at, updated_at
               FROM users WHERE id = ?`, [req.params.id]),
    db.query(`SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`, [req.params.id, now]),
    db.query(`SELECT p.id, p.username_display, p.published FROM profiles p
              WHERE p.owner_user_id = ? ORDER BY p.created_at`, [req.params.id]),
    db.query(`SELECT id, scope, reason, created_at, expires_at FROM bans
               WHERE target_type = 'user' AND target_hash = ? AND lifted_at IS NULL
                 AND (expires_at IS NULL OR expires_at > ?)
               ORDER BY created_at DESC`, [targetHash('user', req.params.id), now]),
    db.query(`SELECT id, status, requested_at, purge_after FROM deletion_requests
               WHERE user_id = ? AND status IN ('pending', 'held')
               ORDER BY requested_at DESC LIMIT 1`, [req.params.id]),
  ]);
  const row = rows[0];
  if (!row) return fail(res, 404, 'Page not found.');
  const { signup_ip_prefix_hash: signupIpHash, ...account } = row;
  const canAction = roleAtLeast(req.user.staff_role, 'administrator')
    && account.id !== req.user.id
    && !protectedTarget(req.user, account);
  res.render('admin/account-detail', {
    title: 'Account administration', account, profiles: profiles.rows,
    activeSessions: Number(sessions.rows[0]?.count || 0), roles: ROLES,
    signupStatuses: SIGNUP_STATUSES, banScopes: BAN_SCOPES, activeBans: bans.rows,
    canManageRole: req.user.staff_role === 'owner' && account.id !== req.user.id,
    canEmergency: roleAtLeast(req.user.staff_role, 'administrator') && account.id !== req.user.id,
    canAction,
    canDecideSignup: canAction && account.signup_status === 'pending',
    hasSignupIp: Boolean(signupIpHash),
    pendingDeletion: deletions.rows[0] || null,
    deletionGraceDays: Math.round(DELETION_GRACE_MS / 86400000),
    accountProfileLimit: profileLimitFor(account),
    defaultProfileLimit: config.MAX_PROFILES_PER_USER,
  });
});
router.post('/admin/accounts/:id/state', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const state = String(req.body.signup_status || '');
  if (!SIGNUP_STATUSES.includes(state)) return fail(res, 400, 'Choose a valid account state.');
  let reason;
  try { reason = prose(req.body.reason, 'Decision note'); } catch (error) {
    if (error instanceof V.ValidationError) return fail(res, 400, error.message);
    throw error;
  }
  const target = await actionableTarget(req, res, { confirmation: 'CHANGE ACCOUNT STATE' });
  if (!target) return undefined;
  if (target.signup_status === state) return fail(res, 409, 'That account is already in that state.');
  const now = Date.now();
  const statements = [{
    sql: `UPDATE users SET signup_status = ?, decided_at = ?, decided_by = ?,
                 decision_note = ?, updated_at = ?
           WHERE id = ? AND signup_status = ?`,
    params: [state, now, req.user.id, reason, now, target.id, target.signup_status],
  }];
  if (state === 'approved' && target.requested_profile_username) {
    const existing = await db.query(
      'SELECT COUNT(*) AS count FROM profiles WHERE owner_user_id = ?',
      [target.id],
    );
    if (Number(existing.rows[0]?.count || 0) === 0) {
      statements.push(...firstProfileStatements({
        userId: target.id,
        username: target.requested_profile_username,
        usernameDisplay: target.requested_profile_username_display || target.requested_profile_username,
        displayName: target.requested_display_name || target.requested_profile_username,
        now,
      }).statements);
    }
  }
  if (state === 'denied') {
    statements.push({
      sql: "DELETE FROM public_username_claims WHERE pending_user_id = ? AND state = 'pending'",
      params: [target.id],
    });
  }
  if (state === 'terminated') {
    statements.push(
      { sql: "UPDATE users SET staff_role = 'none' WHERE id = ?", params: [target.id] },
      { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, target.id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [target.id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [target.id] },
      {
        sql: 'UPDATE profiles SET published = 0, updated_at = ? WHERE owner_user_id = ?',
        params: [now, target.id],
      },
    );
  }
  await db.batch(statements);
  await audit.record({
    type: 'account.state_changed', actorUserId: req.user.id, subjectUserId: target.id,
    ipHash: ipPrefixHash(req), detail: { from: target.signup_status, to: state, reason },
  });
  mail.securityNotice(target.email, STATE_NOTICES[state]).catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
});
router.post('/admin/accounts/:id/delete', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  let reason;
  try { reason = prose(req.body.reason); } catch (error) {
    if (error instanceof V.ValidationError) return fail(res, 400, error.message);
    throw error;
  }
  const target = await actionableTarget(req, res, { confirmation: 'DELETE ACCOUNT' });
  if (!target) return undefined;
  if (target.staff_role !== 'none') {
    return fail(res, 409, 'Remove the staff role before deleting this account.');
  }
  const now = Date.now();
  const id = newId();
  const hold = await db.query('SELECT id FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1', [target.id]);
  try {
    await db.batch([
      {
        sql: `INSERT INTO deletion_requests
                (id, user_id, active_user_key, status, requested_at, purge_after)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [id, target.id, target.id, hold.rows.length ? 'held' : 'pending', now, now + DELETION_GRACE_MS],
      },
      {
        sql: `INSERT INTO deletion_profile_states (deletion_id, profile_id, was_published)
              SELECT ?, p.id, p.published FROM profiles p WHERE p.owner_user_id = ?`,
        params: [id, target.id],
      },
      {
        sql: 'UPDATE profiles SET published = 0, updated_at = ? WHERE owner_user_id = ?',
        params: [now, target.id],
      },
      { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, target.id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [target.id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [target.id] },
    ]);
  } catch {
    return fail(res, 409, 'This account already has an active deletion request.');
  }
  await audit.record({
    type: 'account.deletion_requested_by_staff', actorUserId: req.user.id, subjectUserId: target.id,
    target: id, ipHash: ipPrefixHash(req), detail: { reason, legalHold: hold.rows.length > 0 },
  });
  mail.securityNotice(
    target.email,
    `An Administrator scheduled this account for deletion. Profiles were unpublished and every session ended immediately. The account is erased after ${Math.round(DELETION_GRACE_MS / 86400000)} days.`,
  ).catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
});
router.post('/admin/accounts/:id/delete/now', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  let reason;
  try { reason = prose(req.body.reason); } catch (error) {
    if (error instanceof V.ValidationError) return fail(res, 400, error.message);
    throw error;
  }
  const target = await actionableTarget(req, res, { confirmation: 'DELETE IMMEDIATELY' });
  if (!target) return undefined;
  if (target.staff_role !== 'none') {
    return fail(res, 409, 'Remove the staff role before deleting this account.');
  }
  const hold = await db.query('SELECT id FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1', [target.id]);
  if (hold.rows.length) {
    return fail(res, 409, 'A legal hold covers this account. Release the hold before deleting it.');
  }
  const now = Date.now();
  const id = newId();
  const existing = (await db.query(
    "SELECT id FROM deletion_requests WHERE user_id = ? AND status IN ('pending', 'held') AND active_user_key = ?",
    [target.id, target.id],
  )).rows[0];
  if (!existing) {
    await db.query(
      `INSERT INTO deletion_requests (id, user_id, active_user_key, status, requested_at, purge_after)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [id, target.id, target.id, now, now],
    );
  }
  const deletionId = existing?.id || id;
  const email = target.email;
  const purged = await purgeDeletion(
    { id: deletionId, user_id: target.id },
    now,
    { replacementActorUserId: req.user.id },
  );
  if (!purged) return fail(res, 409, 'A legal hold covers this account. Release the hold before deleting it.');
  await audit.record({
    type: 'account.deleted_immediately', actorUserId: req.user.id,
    target: deletionId, ipHash: ipPrefixHash(req), detail: { reason },
  });
  mail.securityNotice(email, 'An Administrator permanently deleted this account and its associated data. It cannot be restored.').catch(() => {});
  res.redirect('/admin/users');
});
router.post('/admin/accounts/:id/delete/cancel', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  let reason;
  try { reason = prose(req.body.reason); } catch (error) {
    if (error instanceof V.ValidationError) return fail(res, 400, error.message);
    throw error;
  }
  const target = await actionableTarget(req, res, { confirmation: 'CANCEL DELETION' });
  if (!target) return undefined;
  const deletion = (await db.query(
    "SELECT id FROM deletion_requests WHERE user_id = ? AND status IN ('pending', 'held') AND active_user_key = ? AND purge_after > ?",
    [target.id, target.id, Date.now()],
  )).rows[0];
  if (!deletion) return fail(res, 409, 'No cancellable deletion request exists for this account.');
  const now = Date.now();
  await db.batch([
    {
      sql: `UPDATE profiles SET published = (
              SELECT was_published FROM deletion_profile_states s
               WHERE s.deletion_id = ? AND s.profile_id = profiles.id
            ), updated_at = ?
            WHERE id IN (SELECT profile_id FROM deletion_profile_states WHERE deletion_id = ?)`,
      params: [deletion.id, now, deletion.id],
    },
    {
      sql: "UPDATE deletion_requests SET status = 'cancelled', active_user_key = NULL, cancelled_at = ? WHERE id = ?",
      params: [now, deletion.id],
    },
  ]);
  await audit.record({
    type: 'account.deletion_cancelled_by_staff', actorUserId: req.user.id, subjectUserId: target.id,
    target: deletion.id, ipHash: ipPrefixHash(req), detail: { reason },
  });
  mail.securityNotice(target.email, 'An Administrator cancelled the pending deletion of this account. Profile publication state was restored.').catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
});
router.post('/admin/accounts/:id/ban', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const scope = String(req.body.scope || '');
  if (!BAN_SCOPES.includes(scope)) return fail(res, 400, 'Choose a valid ban scope.');
  let reason;
  try { reason = prose(req.body.reason); } catch (error) {
    if (error instanceof V.ValidationError) return fail(res, 400, error.message);
    throw error;
  }
  let expiresAt = null;
  if (req.body.duration_days) {
    const days = Number(req.body.duration_days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return fail(res, 400, 'Duration must be 1 to 3650 days.');
    expiresAt = Date.now() + days * 86400000;
  }
  const target = await actionableTarget(req, res, { confirmation: 'BAN ACCOUNT' });
  if (!target) return undefined;
  await createBan({ type: 'user', value: target.id, scope, reason, createdBy: req.user.id, expiresAt });
  await audit.record({
    type: 'ban.created', actorUserId: req.user.id, subjectUserId: target.id,
    ipHash: ipPrefixHash(req), detail: { scope, expiresAt },
  });
  mail.securityNotice(target.email, `An Administrator applied a ${scope} ban to your account.`).catch(() => {});
  res.redirect(`/admin/accounts/${target.id}`);
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
router.post('/admin/accounts/:id/profile-limit', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const raw = String(req.body.profile_limit ?? '').trim();
  let limit = null;
  if (raw !== '') {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return fail(res, 400, 'A profile limit must be a whole number from 1 to 100, or blank for the site default.');
    }
    limit = parsed;
  }
  const { rows } = await db.query('SELECT id, profile_limit FROM users WHERE id = ?', [req.params.id]);
  const target = rows[0];
  if (!target) return fail(res, 404, 'Page not found.');
  await db.query('UPDATE users SET profile_limit = ?, updated_at = ? WHERE id = ?', [limit, Date.now(), target.id]);
  await audit.record({
    type: 'account.profile_limit_changed', actorUserId: req.user.id, subjectUserId: target.id,
    ipHash: ipPrefixHash(req), detail: { from: target.profile_limit ?? null, to: limit },
  });
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
