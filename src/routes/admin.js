import express from 'express';
import db from '../db/index.js';
import audit from '../audit.js';
import * as mail from '../mail.js';
import { requireStaff } from '../middleware/staff.js';
import { ipPrefixHash } from '../util/net.js';
import { firstProfileStatements } from '../profiles.js';
import { requireFreshAuth } from '../middleware/session.js';
import { decrypt } from '../util/crypto.js';
import config from '../config.js';
import * as V from '../validation.js';
import { newId } from '../util/ids.js';
import { normalizeExemptionValue } from '../content-exemptions.js';
import { createBan, targetHash } from '../bans.js';
import { roleAtLeast } from '../middleware/staff.js';
import { EASTER_EGGS } from '../easter-eggs.js';
const router = express.Router();
const LOOKUP_EGGS = new Map([
  ['sudo', 'Nice try. This is not a shell.'],
  ['root', 'Wrong tree.'],
  ['select *', 'Please step away from the database.'],
  ['nanashi', 'That account is looking back.'],
  ['null', 'Both already have profiles. See /u/null and /u/undefined.'],
  ['undefined', 'Both already have profiles. See /u/null and /u/undefined.'],
]);
const LOOKUP_PATTERN_EGGS = [
  [/drop\s+table|;\s*drop\b/i, 'We use parameterised queries. Thank you for checking.'],
  [/'\s*or\s*'?1'?\s*=\s*'?1/i, 'We use parameterised queries. Thank you for checking.'],
  [/<\s*script\b/i, 'Escaped, as intended.'],
];
export function lookupEgg(email) {
  if (!email) return '';
  const exact = LOOKUP_EGGS.get(email);
  if (exact) return exact;
  return LOOKUP_PATTERN_EGGS.find(([pattern]) => pattern.test(email))?.[1] || '';
}
router.get('/admin', requireStaff('support'), async (req, res) => {
  const pending = await db.query(
    `SELECT id, email, requested_profile_username, requested_display_name, requested_at
       FROM users WHERE signup_status = 'pending' ORDER BY requested_at ASC LIMIT 50`,
  );
  let searched = null;
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const lookupMessage = lookupEgg(email);
  if (email && !lookupMessage) {
    const { rows } = await db.query(
      'SELECT id, email, signup_status, staff_role, twofa_method FROM users WHERE email = ?',
      [email === 'me' ? req.user.email : email],
    );
    searched = rows[0] || null;
  }
  res.render('admin/overview', {
    title: 'Administration',
    canApprove: ['administrator', 'owner'].includes(req.user.staff_role),
    canReport: roleAtLeast(req.user.staff_role, 'moderator'),
    pending: pending.rows,
    searched,
    email,
    lookupMessage,
    selfLookup: email === 'me' && Boolean(searched),
  });
});
router.get('/admin/easter-eggs', requireStaff('support'), (req, res) => {
  res.render('admin/easter-eggs', { title: 'Easter eggs', eggs: EASTER_EGGS });
});
router.get('/admin/content-flags', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const [{ rows }, { rows: selfFlags }] = await Promise.all([db.query(
    `SELECT r.id, r.flag_id, r.requested_at, f.policy_category, f.severity,
            f.field_type, u.email
       FROM content_flag_reviews r
       JOIN content_flags f ON f.id = r.flag_id
       JOIN users u ON u.id = f.user_id
      WHERE r.status = 'pending'
      ORDER BY r.requested_at ASC`,
  ), db.query(
    `SELECT f.id, f.policy_category, f.severity, f.field_type, f.created_at
       FROM content_flags f
      WHERE f.user_id = ? AND f.status = 'pending' AND f.mode = 'enforcing'
      ORDER BY f.created_at DESC`,
    [req.user.id],
  )]);
  const recentlyDecided = rows.length === 0
    ? Number((await db.query(
      `SELECT COUNT(*) AS c FROM content_flag_reviews
        WHERE status <> 'pending' AND decided_at >= ?`,
      [Date.now() - 24 * 60 * 60 * 1000],
    )).rows[0].c)
    : 0;
  res.render('admin/content-flags', {
    title: 'Content flag reviews',
    clearedBacklog: recentlyDecided >= 5,
    reviews: rows.map((row) => ({ ...row, requestedAt: new Date(Number(row.requested_at)).toISOString() })),
    selfFlags: selfFlags.map((row) => ({ ...row, createdAt: new Date(Number(row.created_at)).toISOString() })),
  });
});
router.get('/admin/suspensions', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.threshold_count, s.window_hours, s.created_at,
            s.status, u.email, u.staff_role
       FROM content_suspensions s
       JOIN users u ON u.id = s.user_id
      WHERE s.status IN ('pending', 'extended') AND s.active_user_key IS NOT NULL
      ORDER BY s.created_at ASC`,
  );
  res.render('admin/suspensions', {
    title: 'Content suspensions',
    suspensions: rows.map((row) => ({ ...row, createdAt: new Date(Number(row.created_at)).toISOString() })),
  });
});
router.post(
  '/admin/suspensions/:id/decision',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/suspensions' }),
  async (req, res) => {
    const action = String(req.body.action || '');
    if (!['cleared', 'restored', 'extended', 'terminated', 'banned'].includes(action)) {
      return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: 'Choose a valid suspension decision.' });
    }
    let reason;
    try {
      reason = V.proseText(req.body.reason, { field: 'Decision reason', max: 500 });
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: error.message });
    }
    const { rows } = await db.query(
      `SELECT s.id, s.user_id, s.created_at, s.status, u.email, u.staff_role
         FROM content_suspensions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.status IN ('pending', 'extended') AND s.active_user_key IS NOT NULL`,
      [req.params.id],
    );
    const suspension = rows[0];
    if (!suspension) {
      return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That suspension is no longer pending.' });
    }
    if (suspension.user_id === req.user.id) {
      return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Staff cannot decide their own suspension.' });
    }
    if (roleAtLeast(suspension.staff_role, 'administrator') && req.user.staff_role !== 'owner') {
      return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Only an Owner may take account action against Administrator or Owner staff.' });
    }
    const confirmation = {
      extended: 'EXTEND SUSPENSION', terminated: 'TERMINATE ACCOUNT', banned: 'BAN ACCOUNT',
    }[action];
    if (confirmation && req.body.confirmation !== confirmation) {
      return res.status(400).render('error', { title: 'Confirmation required', status: 400, message: `Type ${confirmation} exactly to continue.` });
    }
    const now = Date.now();
    let createdBanId = null;
    const statements = [
      {
        sql: `UPDATE content_suspensions
                 SET status = ?, active_user_key = NULL, decided_by = ?,
                     decision_reason = ?, decided_at = ?
               WHERE id = ? AND status IN ('pending', 'extended') AND active_user_key IS NOT NULL`,
        params: [action, req.user.id, reason, now, suspension.id],
      },
      {
        sql: `UPDATE sessions SET revoked_at = ?
              WHERE user_id = ? AND revoked_at IS NULL`,
        params: [now, suspension.user_id],
      },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [suspension.user_id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [suspension.user_id] },
    ];
    if (action === 'extended') {
      statements[0].sql = statements[0].sql.replace('active_user_key = NULL', 'active_user_key = ?');
      statements[0].params = [action, suspension.user_id, req.user.id, reason, now, suspension.id];
    }
    if (['cleared', 'restored'].includes(action)) {
      statements.push({
        sql: `UPDATE profiles SET published = (
                SELECT was_published FROM content_suspension_profiles sp
                 WHERE sp.suspension_id = ? AND sp.profile_id = profiles.id
              ), updated_at = ?
              WHERE id IN (SELECT profile_id FROM content_suspension_profiles WHERE suspension_id = ?)`,
        params: [suspension.id, now, suspension.id],
      });
    }
    if (action === 'cleared') {
      statements.push({
        sql: `UPDATE content_flags SET status = 'cleared', auto_suspension_eligible = 0,
                  decided_by = ?, decided_at = ?
              WHERE user_id = ? AND auto_suspension_eligible = 1
                AND created_at >= ? AND created_at <= ?`,
        params: [req.user.id, now, suspension.user_id, Number(suspension.created_at) - 24 * 60 * 60 * 1000, Number(suspension.created_at)],
      });
      statements.push({
        sql: `UPDATE content_flag_reviews SET status = 'cleared', decided_by = ?,
                     decision_reason = ?, decided_at = ?
               WHERE status = 'pending' AND flag_id IN
                     (SELECT id FROM content_flags WHERE user_id = ? AND status = 'cleared')`,
        params: [req.user.id, reason, now, suspension.user_id],
      });
    }
    if (['restored', 'extended', 'terminated', 'banned'].includes(action)) {
      statements.push(
        {
          sql: `UPDATE content_flags SET status = 'upheld', decided_by = ?, decided_at = ?
                 WHERE user_id = ? AND status = 'pending' AND mode = 'enforcing'`,
          params: [req.user.id, now, suspension.user_id],
        },
        {
          sql: `UPDATE content_flag_reviews SET status = 'upheld', decided_by = ?,
                       decision_reason = ?, decided_at = ?
                 WHERE status = 'pending' AND flag_id IN
                       (SELECT id FROM content_flags WHERE user_id = ?)`,
          params: [req.user.id, reason, now, suspension.user_id],
        },
      );
    }
    if (action === 'terminated') {
      statements.push({
        sql: `UPDATE users SET signup_status = 'terminated', staff_role = 'none',
                    decided_by = ?, decision_note = ?, decided_at = ?, updated_at = ?
               WHERE id = ?`,
        params: [req.user.id, reason, now, now, suspension.user_id],
      });
    }
    if (action === 'banned') {
      const banScope = req.body.ban_scope === 'account' ? 'account' : 'both';
      createdBanId = newId();
      statements.push({
        sql: `INSERT INTO bans
                (id, target_type, target_value, target_hash, scope, reason, created_by, created_at)
              VALUES (?, 'user', ?, ?, ?, ?, ?, ?)`,
        params: [createdBanId, suspension.user_id, targetHash('user', suspension.user_id), banScope, reason, req.user.id, now],
      });
    }
    await db.batch(statements);
    await audit.record({
      type: `content_suspension.${action}`, actorUserId: req.user.id,
      subjectUserId: suspension.user_id, target: suspension.id, ipHash: ipPrefixHash(req),
    });
    if (createdBanId) {
      await audit.record({
        type: 'ban.created', actorUserId: req.user.id, subjectUserId: suspension.user_id,
        target: createdBanId, ipHash: ipPrefixHash(req), detail: { scope: req.body.ban_scope === 'account' ? 'account' : 'both' },
      });
    }
    const notices = {
      cleared: 'The temporary content restriction was cleared. Sign in again to continue.',
      restored: 'Normal account access was restored with a warning. Sign in again to continue.',
      extended: 'The temporary content restriction was converted to a staff suspension. Restricted review access remains available.',
      terminated: 'The account was terminated after Administrator review.',
      banned: 'An account ban was imposed after Administrator review.',
    };
    mail.securityNotice(suspension.email, notices[action]).catch(() => {});
    res.redirect('/admin/suspensions');
  },
);
async function findOwnPendingFlag(userId, flagId) {
  const { rows } = await db.query(
    `SELECT f.id, f.user_id, f.profile_id, f.rule_version_id, f.field_type,
            f.field_index, f.attempted_ciphertext, f.attempted_nonce,
            f.policy_category, f.severity, u.email, v.rule_id, v.version, v.rule_type
       FROM content_flags f
       JOIN users u ON u.id = f.user_id
       JOIN content_rule_versions v ON v.id = f.rule_version_id
      WHERE f.id = ? AND f.user_id = ? AND f.status = 'pending' AND f.mode = 'enforcing'`,
    [flagId, userId],
  );
  return rows[0] || null;
}
router.get('/admin/content-flags/self/:flagId', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const flag = await findOwnPendingFlag(req.user.id, req.params.flagId);
  if (!flag) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const attemptedValue = decrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, flag.attempted_ciphertext, flag.attempted_nonce);
  res.render('admin/content-self-exemption', {
    title: 'Create personal content exemption', flag, attemptedValue,
  });
});
router.post(
  '/admin/content-flags/self/:flagId',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-flags' }),
  async (req, res) => {
    if (req.body.confirmation !== 'CREATE EXEMPTION') {
      return res.status(400).render('error', { title: 'Confirmation required', status: 400, message: 'Type CREATE EXEMPTION exactly to continue.' });
    }
    const scope = String(req.body.scope || '');
    const expiry = String(req.body.expiry || '');
    if (!['account', 'profile'].includes(scope) || !['none', '7', '30', '90'].includes(expiry)) {
      return res.status(400).render('error', { title: 'Invalid exemption', status: 400, message: 'Choose a valid scope and expiry.' });
    }
    let reason;
    try {
      reason = V.displayText(req.body.reason, { field: 'Exemption reason', max: 200 });
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return res.status(400).render('error', { title: 'Invalid exemption', status: 400, message: error.message });
    }
    const flag = await findOwnPendingFlag(req.user.id, req.params.flagId);
    if (!flag) {
      return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That flag is no longer eligible.' });
    }
    if (scope === 'profile' && !flag.profile_id) {
      return res.status(400).render('error', { title: 'Invalid exemption', status: 400, message: 'This flag has no profile scope.' });
    }
    const attemptedValue = decrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, flag.attempted_ciphertext, flag.attempted_nonce);
    const now = Date.now();
    const expiresAt = expiry === 'none' ? null : now + Number(expiry) * 24 * 60 * 60 * 1000;
    const profileId = scope === 'profile' ? flag.profile_id : null;
    const value = normalizeExemptionValue(flag.field_type, attemptedValue);
    await db.batch([
      { sql: 'UPDATE users SET updated_at = updated_at WHERE id = ?', params: [req.user.id] },
      {
        sql: `INSERT INTO content_rule_exemptions
                (id, rule_version_id, field_type, normalized_value, user_id,
                 profile_id, reason, created_by, self_exemption, expires_at, created_at)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM content_rule_exemptions
                  WHERE rule_version_id = ? AND field_type = ? AND normalized_value = ?
                    AND user_id = ? AND ((profile_id IS NULL AND CAST(? AS TEXT) IS NULL) OR profile_id = ?)
                    AND self_exemption = 1 AND revoked_at IS NULL
                    AND (expires_at IS NULL OR expires_at > ?)
               )`,
        params: [
          newId(), flag.rule_version_id, flag.field_type, value, req.user.id,
          profileId, reason, req.user.id, expiresAt, now,
          flag.rule_version_id, flag.field_type, value, req.user.id,
          profileId, profileId, now,
        ],
      },
      {
        sql: `UPDATE content_flags SET status = 'exempted', auto_suspension_eligible = 0,
                    decided_by = ?, decided_at = ?
               WHERE id = ? AND user_id = ? AND status = 'pending'`,
        params: [req.user.id, now, flag.id, req.user.id],
      },
    ]);
    await audit.record({
      type: 'content_rule.self_exemption_created', actorUserId: req.user.id,
      subjectUserId: req.user.id, target: flag.id, ipHash: ipPrefixHash(req),
      detail: { scope, expires: expiresAt === null ? 'never' : new Date(expiresAt).toISOString() },
    });
    mail.securityNotice(flag.email, `A personal content-rule exemption was created with ${scope} scope. Review your account if this was not you.`).catch(() => {});
    res.redirect('/admin/content-flags');
  },
);
router.get('/admin/content-flags/:reviewId', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.explanation, r.status AS review_status, r.requested_at,
            f.id AS flag_id, f.user_id, f.profile_id, f.rule_version_id,
            f.field_type, f.field_index, f.attempted_ciphertext,
            f.attempted_nonce, f.policy_category, f.severity, f.status AS flag_status,
            u.email, v.rule_id, v.rule_type, v.explanation AS rule_explanation
       FROM content_flag_reviews r
       JOIN content_flags f ON f.id = r.flag_id
       JOIN users u ON u.id = f.user_id
       JOIN content_rule_versions v ON v.id = f.rule_version_id
      WHERE r.id = ?`,
    [req.params.reviewId],
  );
  const review = rows[0];
  if (!review) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const attemptedValue = decrypt(
    config.CONTENT_FLAG_ENCRYPTION_KEY,
    review.attempted_ciphertext,
    review.attempted_nonce,
  );
  res.render('admin/content-flag-detail', {
    title: 'Content flag review',
    review,
    attemptedValue,
    canDecide: review.review_status === 'pending' && review.flag_status === 'pending' && review.user_id !== req.user.id,
  });
});
router.post(
  '/admin/content-flags/:reviewId/decision',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-flags' }),
  async (req, res) => {
    const action = String(req.body.action || '');
    if (!['upheld', 'cleared', 'exempted'].includes(action)) {
      return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: 'Choose a valid review decision.' });
    }
    let reason;
    try {
      reason = V.proseText(req.body.reason, { field: 'Decision reason', max: 500 });
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: error.message });
    }
    const { rows } = await db.query(
      `SELECT r.id, r.status AS review_status, f.id AS flag_id, f.status AS flag_status,
              f.user_id, f.profile_id, f.rule_version_id, f.field_type,
              f.attempted_ciphertext, f.attempted_nonce, u.email
         FROM content_flag_reviews r
         JOIN content_flags f ON f.id = r.flag_id
         JOIN users u ON u.id = f.user_id
        WHERE r.id = ?`,
      [req.params.reviewId],
    );
    const review = rows[0];
    if (!review || review.review_status !== 'pending' || review.flag_status !== 'pending') {
      return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That review is no longer pending.' });
    }
    if (review.user_id === req.user.id) {
      return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Staff cannot decide their own content flag.' });
    }
    const now = Date.now();
    const statements = [
      {
        sql: `UPDATE content_flag_reviews
                 SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ?
               WHERE id = ? AND status = 'pending'`,
        params: [action, req.user.id, reason, now, review.id],
      },
      {
        sql: `UPDATE content_flags
                 SET status = ?, auto_suspension_eligible = ?, decided_by = ?, decided_at = ?
               WHERE id = ? AND status = 'pending'`,
        params: [action, action === 'upheld' ? 1 : 0, req.user.id, now, review.flag_id],
      },
    ];
    if (action === 'exempted') {
      const attemptedValue = decrypt(
        config.CONTENT_FLAG_ENCRYPTION_KEY,
        review.attempted_ciphertext,
        review.attempted_nonce,
      );
      statements.push({
        sql: `INSERT INTO content_rule_exemptions
                (id, rule_version_id, field_type, normalized_value,
                 user_id, profile_id, reason, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId(), review.rule_version_id, review.field_type,
          normalizeExemptionValue(review.field_type, attemptedValue),
          review.user_id, review.profile_id, reason, req.user.id, now,
        ],
      });
    }
    await db.batch(statements);
    await audit.record({
      type: `content_flag.review_${action}`, actorUserId: req.user.id,
      subjectUserId: review.user_id, target: review.flag_id, ipHash: ipPrefixHash(req),
    });
    mail.contentReviewDecision(review.email, action).catch(() => {});
    res.redirect('/admin/content-flags');
  },
);
const DECISION_RETURN_PATHS = ['/admin', '/admin/signups'];
const DENY_BAN_TARGETS = ['email', 'domain', 'user', 'ip_prefix'];
function decisionReturn(body, targetId) {
  const requested = String(body.return_to || '');
  if (requested === 'account') return `/admin/accounts/${targetId}`;
  return DECISION_RETURN_PATHS.includes(requested) ? requested : '/admin';
}
function optionalReason(value, field) {
  if (value == null || String(value).trim() === '') return null;
  return V.proseText(String(value), { field, min: 3, max: 500 });
}
function decisionReasons(body) {
  return {
    publicReason: optionalReason(body.reason_public, 'Reason shown to the applicant'),
    note: optionalReason(body.decision_note, 'Internal note'),
  };
}
export function requestedBans(body) {
  const selected = Array.isArray(body.ban_target) ? body.ban_target : [body.ban_target];
  const targets = selected.map(String).filter((target) => DENY_BAN_TARGETS.includes(target));
  if (!targets.length) return { targets: [], scope: 'account', expiresAt: null };
  if (body.ban_confirmation !== 'BAN APPLICANT') {
    throw new V.ValidationError('Type BAN APPLICANT exactly to ban an applicant while denying their request.');
  }
  const scope = ['account', 'viewing', 'both'].includes(String(body.ban_scope)) ? String(body.ban_scope) : 'account';
  let expiresAt = null;
  if (body.ban_duration_days != null && String(body.ban_duration_days).trim() !== '') {
    const days = Number(body.ban_duration_days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new V.ValidationError('Ban duration must be 1 to 3650 days.');
    }
    expiresAt = Date.now() + days * 86400000;
  }
  return { targets: [...new Set(targets)], scope, expiresAt };
}
function emailDomainOf(email) {
  const at = String(email).lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : '';
}
async function applyDenyBans(req, target, bans, reason) {
  const applied = [];
  for (const kind of bans.targets) {
    const common = { scope: bans.scope, reason, createdBy: req.user.id, expiresAt: bans.expiresAt };
    if (kind === 'email') await createBan({ type: 'email', value: target.email, ...common });
    if (kind === 'domain') {
      const domain = emailDomainOf(target.email);
      if (!domain) continue;
      await createBan({ type: 'domain', value: domain, ...common });
    }
    if (kind === 'user') await createBan({ type: 'user', value: target.id, ...common });
    if (kind === 'ip_prefix') {
      if (!target.signup_ip_prefix_hash) continue;
      await createBan({ type: 'ip', valueHash: target.signup_ip_prefix_hash, ...common });
    }
    applied.push(kind);
  }
  if (applied.length) {
    await audit.record({
      type: 'account.denied_with_bans', actorUserId: req.user.id, subjectUserId: target.id,
      ipHash: ipPrefixHash(req), detail: { targets: applied, scope: bans.scope, expiresAt: bans.expiresAt },
    });
  }
  return applied;
}
router.post('/admin/accounts/:id/approve', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const now = Date.now();
  let reasons;
  try { reasons = decisionReasons(req.body); } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Administration', status: 400, message: error.message });
  }
  const { rows } = await db.query(
    'SELECT id, email, signup_status, requested_profile_username, requested_profile_username_display, requested_display_name FROM users WHERE id = ?',
    [req.params.id],
  );
  const target = rows[0];
  if (!target || target.signup_status !== 'pending') {
    return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That request is not pending.' });
  }
  if (target.id === req.user.id) {
    return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Staff cannot decide their own account.' });
  }
  const statements = [
    {
      sql: `UPDATE users SET signup_status = ?, decided_at = ?, decided_by = ?,
                   decision_note = ?, decision_reason_public = ?, updated_at = ?
             WHERE id = ? AND signup_status = ?`,
      params: ['approved', now, req.user.id, reasons.note, reasons.publicReason, now, target.id, 'pending'],
    },
  ];
  if (target.requested_profile_username) {
    statements.push(
      ...firstProfileStatements({
        userId: target.id,
        username: target.requested_profile_username,
        usernameDisplay: target.requested_profile_username_display || target.requested_profile_username,
        displayName: target.requested_display_name || target.requested_profile_username,
        now,
      }).statements,
    );
  }
  await db.batch(statements);
  await audit.record({ type: 'account.approved', actorUserId: req.user.id, subjectUserId: target.id, ipHash: ipPrefixHash(req), detail: { note: reasons.note } });
  mail.decisionEmail(target.email, { outcome: 'approved', reason: reasons.publicReason }).catch(() => {});
  res.redirect(decisionReturn(req.body, target.id));
});
router.post('/admin/accounts/:id/deny', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin' }), async (req, res) => {
  const now = Date.now();
  let reasons;
  let bans;
  try {
    reasons = decisionReasons(req.body);
    bans = requestedBans(req.body);
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Administration', status: 400, message: error.message });
  }
  const { rows } = await db.query(
    'SELECT id, email, signup_status, signup_ip_prefix_hash FROM users WHERE id = ?',
    [req.params.id],
  );
  const target = rows[0];
  if (!target || target.signup_status !== 'pending') {
    return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That request is not pending.' });
  }
  if (target.id === req.user.id) {
    return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Staff cannot decide their own account.' });
  }
  await db.batch([
    { sql: 'DELETE FROM public_username_claims WHERE pending_user_id = ? AND state = ?', params: [target.id, 'pending'] },
    {
      sql: `UPDATE users SET signup_status = ?, decided_at = ?, decided_by = ?,
                   decision_note = ?, decision_reason_public = ?, updated_at = ?
             WHERE id = ? AND signup_status = ?`,
      params: ['denied', now, req.user.id, reasons.note, reasons.publicReason, now, target.id, 'pending'],
    },
  ]);
  await audit.record({ type: 'account.denied', actorUserId: req.user.id, subjectUserId: target.id, ipHash: ipPrefixHash(req), detail: { note: reasons.note } });
  const applied = await applyDenyBans(req, target, bans, reasons.note || reasons.publicReason || 'Signup request denied.');
  if (applied.includes('email') || applied.includes('domain') || applied.includes('user')) {
    mail.securityNotice(target.email, `An Administrator applied a ${bans.scope} ban while denying the account request.`).catch(() => {});
  }
  mail.decisionEmail(target.email, { outcome: 'denied', reason: reasons.publicReason }).catch(() => {});
  res.redirect(decisionReturn(req.body, target.id));
});
export default router;
