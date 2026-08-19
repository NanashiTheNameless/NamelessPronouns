import express from 'express';
import db from '../db/index.js';
import config from '../config.js';
import audit from '../audit.js';
import * as mail from '../mail.js';
import * as V from '../validation.js';
import { requireStaff, roleAtLeast } from '../middleware/staff.js';
import { requireFreshAuth } from '../middleware/session.js';
import { hashPassword, PasswordPolicyError } from '../auth/password.js';
import { keyedHash } from '../util/crypto.js';
import { newId, newToken } from '../util/ids.js';
import { ipPrefixHash } from '../util/net.js';
const router = express.Router();
const EVIDENCE = new Set(['unverified_intake', 'mailbox_and_offline_record', 'mailbox_and_operator_record', 'owner_emergency']);
router.get('/admin/recovery', requireStaff('support'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.user_id, c.status, c.evidence_category, c.reason, c.created_at,
            u.email, u.staff_role
       FROM recovery_cases c JOIN users u ON u.id = c.user_id
      WHERE c.status IN ('pending', 'approved') ORDER BY c.created_at ASC`,
  );
  res.render('admin/recovery', {
    title: 'Recovery cases',
    cases: rows.map((row) => ({ ...row, createdAt: new Date(Number(row.created_at)).toISOString() })),
    canDecide: roleAtLeast(req.user.staff_role, 'administrator'),
  });
});
router.get('/admin/legal-holds', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT h.id, h.user_id, h.scope, h.reason, h.started_at, h.review_at, u.email
       FROM legal_holds h JOIN users u ON u.id = h.user_id
      WHERE h.released_at IS NULL ORDER BY h.review_at ASC`,
  );
  res.render('admin/legal-holds', {
    title: 'Legal holds',
    holds: rows.map((row) => ({
      ...row, startedAt: new Date(Number(row.started_at)).toISOString(), reviewAt: new Date(Number(row.review_at)).toISOString(),
    })),
  });
});
router.post('/admin/legal-holds', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/legal-holds' }), async (req, res) => {
  if (req.body.confirmation !== 'CREATE LEGAL HOLD') {
    return res.status(400).render('error', { title: 'Hold not created', status: 400, message: 'Type CREATE LEGAL HOLD exactly to continue.' });
  }
  let email;
  let scope;
  let reason;
  try {
    email = V.email(req.body.email, { field: 'Account email' });
    scope = V.displayText(req.body.scope, { field: 'Hold scope', max: 100 });
    reason = V.displayText(req.body.reason, { field: 'Hold reason', max: 200 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Hold not created', status: 400, message: error.message });
  }
  const reviewDays = Number(req.body.review_days);
  if (![30, 90, 365].includes(reviewDays)) return res.status(400).render('error', { title: 'Hold not created', status: 400, message: 'Choose a valid review interval.' });
  const target = (await db.query('SELECT id FROM users WHERE email = ?', [email])).rows[0];
  if (!target) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'No account matches that exact email.' });
  const now = Date.now();
  const id = newId();
  await db.batch([
    { sql: 'INSERT INTO legal_holds (id, user_id, scope, reason, created_by, started_at, review_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [id, target.id, scope, reason, req.user.id, now, now + reviewDays * 24 * 60 * 60 * 1000] },
    { sql: "UPDATE deletion_requests SET status = 'held' WHERE user_id = ? AND status = 'pending' AND active_user_key = ?", params: [target.id, target.id] },
  ]);
  await audit.record({ type: 'legal_hold.created', actorUserId: req.user.id, subjectUserId: target.id, target: id, ipHash: ipPrefixHash(req), detail: { reviewDays } });
  res.redirect('/admin/legal-holds');
});
router.post('/admin/legal-holds/:id/release', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/legal-holds' }), async (req, res) => {
  if (req.body.confirmation !== 'RELEASE LEGAL HOLD') {
    return res.status(400).render('error', { title: 'Hold not released', status: 400, message: 'Type RELEASE LEGAL HOLD exactly to continue.' });
  }
  let reason;
  try {
    reason = V.displayText(req.body.reason, { field: 'Release reason', max: 200 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Hold not released', status: 400, message: error.message });
  }
  const hold = (await db.query('SELECT id, user_id FROM legal_holds WHERE id = ? AND released_at IS NULL', [req.params.id])).rows[0];
  if (!hold) return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That hold is no longer active.' });
  const now = Date.now();
  await db.batch([
    { sql: 'UPDATE legal_holds SET released_at = ? WHERE id = ? AND released_at IS NULL', params: [now, hold.id] },
    {
      sql: `UPDATE deletion_requests SET status = 'pending'
             WHERE user_id = ? AND status = 'held' AND active_user_key = ?
               AND NOT EXISTS (SELECT 1 FROM legal_holds WHERE user_id = ? AND released_at IS NULL AND id <> ?)`,
      params: [hold.user_id, hold.user_id, hold.user_id, hold.id],
    },
  ]);
  await audit.record({ type: 'legal_hold.released', actorUserId: req.user.id, subjectUserId: hold.user_id, target: hold.id, ipHash: ipPrefixHash(req), detail: { reason } });
  res.redirect('/admin/legal-holds');
});
router.post('/admin/recovery', requireStaff('support'), requireFreshAuth({ returnTo: '/admin/recovery' }), async (req, res) => {
  let email;
  let reason;
  const evidence = String(req.body.evidence_category || '');
  try {
    email = V.email(req.body.email, { field: 'Account email' });
    reason = V.displayText(req.body.reason, { field: 'Intake reason', max: 200 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Case not opened', status: 400, message: error.message });
  }
  if (!EVIDENCE.has(evidence)) return res.status(400).render('error', { title: 'Case not opened', status: 400, message: 'Choose a valid evidence category.' });
  if (evidence === 'owner_emergency' && req.user.staff_role !== 'owner') {
    return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Only an Owner may document an emergency exception.' });
  }
  const target = (await db.query(
    "SELECT id, email FROM users WHERE email = ? AND signup_status = 'approved'",
    [email],
  )).rows[0];
  if (!target) return res.status(400).render('error', { title: 'Case not opened', status: 400, message: 'No eligible account matches that exact email.' });
  const id = newId();
  try {
    await db.query(
      `INSERT INTO recovery_cases
         (id, user_id, active_user_key, evidence_category, reason, opened_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, target.id, target.id, evidence, reason, req.user.id, Date.now()],
    );
  } catch {
    return res.status(409).render('error', { title: 'Case not opened', status: 409, message: 'That account already has an active recovery case.' });
  }
  await audit.record({ type: 'recovery.case_opened', actorUserId: req.user.id, subjectUserId: target.id, target: id, ipHash: ipPrefixHash(req), detail: { evidenceCategory: evidence } });
  mail.securityNotice(target.email, 'An administrative account-recovery case was opened. Recovery is not guaranteed and no credentials have changed.').catch(() => {});
  mail.adminActionNeeded('recovery_case', `admin:recovery:${id}`).catch(() => {});
  res.redirect('/admin/recovery');
});
router.post('/admin/recovery/:id/decision', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/recovery' }), async (req, res) => {
  const action = String(req.body.action || '');
  if (!['approved', 'denied'].includes(action)) return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: 'Choose approve or deny.' });
  const confirmation = action === 'approved' ? 'APPROVE RECOVERY' : 'DENY RECOVERY';
  if (req.body.confirmation !== confirmation) return res.status(400).render('error', { title: 'Confirmation required', status: 400, message: `Type ${confirmation} exactly to continue.` });
  let reason;
  try {
    reason = V.displayText(req.body.reason, { field: 'Decision reason', max: 200 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Invalid decision', status: 400, message: error.message });
  }
  const recovery = (await db.query(
    `SELECT c.id, c.user_id, c.evidence_category, c.opened_by, u.email, u.staff_role
       FROM recovery_cases c JOIN users u ON u.id = c.user_id
      WHERE c.id = ? AND c.status = 'pending' AND c.active_user_key IS NOT NULL`,
    [req.params.id],
  )).rows[0];
  if (!recovery) return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That case is no longer pending.' });
  if (recovery.user_id === req.user.id) return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Staff cannot recover their own account.' });
  if (roleAtLeast(recovery.staff_role, 'administrator') && req.user.staff_role !== 'owner') {
    return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Only an Owner may recover Administrator or Owner staff.' });
  }
  if (action === 'approved' && recovery.evidence_category === 'unverified_intake') {
    return res.status(409).render('error', { title: 'Verification required', status: 409, message: 'Record two-signal verification before approval.' });
  }
  if (recovery.evidence_category === 'owner_emergency' && req.user.staff_role !== 'owner') {
    return res.status(403).render('error', { title: 'Blocked', status: 403, message: 'Only an Owner may approve an emergency exception.' });
  }
  const now = Date.now();
  let token = null;
  if (action === 'approved') token = newToken(32);
  await db.query(
    `UPDATE recovery_cases SET status = ?, active_user_key = ?, decided_by = ?,
            decision_reason = ?, recovery_token_hash = ?, recovery_expires_at = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'`,
    [action, action === 'approved' ? recovery.user_id : null, req.user.id, reason,
      token ? keyedHash(token) : null, token ? now + 30 * 60 * 1000 : null, now, recovery.id],
  );
  await audit.record({ type: `recovery.${action}`, actorUserId: req.user.id, subjectUserId: recovery.user_id, target: recovery.id, ipHash: ipPrefixHash(req) });
  if (token) {
    await mail.recoveryLink(recovery.email, `${config.BASE_URL}/account/recovery/${token}`, `recovery:${recovery.id}`);
  } else {
    mail.securityNotice(recovery.email, 'The administrative recovery case was closed without changing account credentials.').catch(() => {});
  }
  res.redirect('/admin/recovery');
});
router.get('/account/recovery/:token', async (req, res) => {
  const found = await db.query(
    `SELECT id FROM recovery_cases WHERE recovery_token_hash = ? AND status = 'approved'
      AND active_user_key IS NOT NULL AND recovery_expires_at > ?`,
    [keyedHash(req.params.token), Date.now()],
  );
  if (!found.rows[0]) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  res.set('Referrer-Policy', 'no-referrer');
  res.render('account/recovery-reset', { title: 'Complete account recovery', token: req.params.token, error: null });
});
router.post('/account/recovery/:token', async (req, res) => {
  const password = String(req.body.password || '');
  if (password !== String(req.body.confirm_password || '')) {
    return res.status(400).render('account/recovery-reset', { title: 'Complete account recovery', token: req.params.token, error: 'The passwords do not match.' });
  }
  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch (error) {
    if (!(error instanceof PasswordPolicyError)) throw error;
    return res.status(400).render('account/recovery-reset', { title: 'Complete account recovery', token: req.params.token, error: error.message });
  }
  const now = Date.now();
  const recovery = (await db.query(
    `SELECT c.id, c.user_id, u.email FROM recovery_cases c JOIN users u ON u.id = c.user_id
      WHERE c.recovery_token_hash = ? AND c.status = 'approved' AND c.active_user_key IS NOT NULL
        AND c.recovery_expires_at > ?`,
    [keyedHash(req.params.token), now],
  )).rows[0];
  if (!recovery) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  await db.batch([
    { sql: `UPDATE recovery_cases SET status = 'completed', active_user_key = NULL,
                  recovery_token_hash = NULL, completed_at = ? WHERE id = ? AND status = 'approved'`, params: [now, recovery.id] },
    { sql: `UPDATE users SET password_hash = ?, password_hash_version = ?, twofa_method = 'email',
                  totp_secret_ciphertext = NULL, totp_secret_nonce = NULL, totp_key_version = NULL,
                  totp_confirmed_at = NULL, totp_last_step = NULL,
                  password_reset_required_at = NULL, password_reset_required_reason = NULL,
                  updated_at = ? WHERE id = ?`, params: [hashed.hash, hashed.version, now, recovery.user_id] },
    { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [recovery.user_id] },
    { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, recovery.user_id] },
    { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [recovery.user_id] },
    { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [recovery.user_id] },
  ]);
  await audit.record({ type: 'recovery.completed', subjectUserId: recovery.user_id, target: recovery.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(recovery.email, 'Administrative recovery was completed. The password was reset, email-code 2FA was selected, and all sessions were signed out.').catch(() => {});
  res.render('auth/verified', { title: 'Recovery complete' });
});
export default router;
