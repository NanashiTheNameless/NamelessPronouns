import express from 'express';
import QRCode from 'qrcode';
import db from '../db/index.js';
import config from '../config.js';
import audit from '../audit.js';
import * as mail from '../mail.js';
import { requireApproved, requireFreshAuth } from '../middleware/session.js';
import { verifyPassword, hashPassword, PasswordPolicyError } from '../auth/password.js';
import * as totp from '../auth/totp.js';
import * as reauth from '../auth/reauth.js';
import { consume } from '../ratelimit.js';
import { ipPrefixHash, clientIp } from '../util/net.js';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, keyedHash, safeEqual } from '../util/crypto.js';
import { newId, newToken } from '../util/ids.js';
import { revokeAllForUser } from '../auth/session.js';
import { collectUserData, buildExportZip, exportFilename } from '../data-export.js';
import { matchAccountBan } from '../bans.js';
import { evaluateEmailDomain } from '../email-domains.js';
import * as V from '../validation.js';
import { avatarUrl, validateAvatarDataUri, MAX_AVATAR_DATA_URI_BYTES } from '../avatar.js';
import { DELETION_GRACE_MS } from '../maintenance.js';
const router = express.Router();
router.get('/account', requireApproved, (req, res) => res.redirect('/settings'));
router.get('/settings', requireApproved, (req, res) => {
  res.render('account/settings', {
    title: 'Settings', method: req.user.twofa_method, avatar: avatarUrl(req.user),
    avatarSource: req.user.avatar_source, maxAvatarBytes: MAX_AVATAR_DATA_URI_BYTES,
    identiconAvatar: avatarUrl({ ...req.user, avatar_source: 'identicon', avatar_data_uri: null }),
    gravatarAvatar: avatarUrl({ ...req.user, avatar_source: 'gravatar', avatar_data_uri: null }),
  });
});
router.post('/account/avatar', requireApproved, async (req, res) => {
  const source = String(req.body.avatar_source || '');
  if (!['gravatar', 'identicon', 'data'].includes(source)) {
    return res.status(400).render('error', { title: 'Avatar unchanged', status: 400, message: 'Choose a valid avatar source.' });
  }
  let dataUri = null;
  if (source === 'data') {
    try {
      dataUri = validateAvatarDataUri(req.body.avatar_data_uri);
    } catch (error) {
      return res.status(400).render('error', { title: 'Avatar unchanged', status: 400, message: error.message });
    }
  }
  await db.query(
    'UPDATE users SET avatar_source = ?, avatar_data_uri = ?, updated_at = ? WHERE id = ?',
    [source, dataUri, Date.now(), req.user.id],
  );
  await audit.record({ type: 'account.avatar_changed', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req), detail: { source } });
  res.redirect('/settings');
});
router.get('/account/deletion', requireApproved, async (req, res) => {
  const deletion = (await db.query(
    "SELECT id, status, requested_at, purge_after FROM deletion_requests WHERE user_id = ? AND status IN ('pending', 'held') AND active_user_key = ?",
    [req.user.id, req.user.id],
  )).rows[0] || null;
  res.render('account/deletion', {
    title: 'Delete account', deletion,
    purgeAt: deletion ? new Date(Number(deletion.purge_after)).toISOString() : null,
  });
});
router.post('/account/deletion', requireApproved, requireFreshAuth({ returnTo: '/account/deletion' }), async (req, res) => {
  if (req.body.confirmation !== 'DELETE MY ACCOUNT') {
    return res.status(400).render('error', { title: 'Deletion not requested', status: 400, message: 'Type DELETE MY ACCOUNT exactly to continue.' });
  }
  if (req.user.staff_role !== 'none') {
    return res.status(409).render('error', { title: 'Deletion unavailable', status: 409, message: 'Remove the staff role through an authorized Owner before deleting this account.' });
  }
  const now = Date.now();
  const id = newId();
  const hold = await db.query('SELECT id FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1', [req.user.id]);
  try {
    await db.batch([
      {
        sql: `INSERT INTO deletion_requests
                (id, user_id, active_user_key, status, requested_at, purge_after)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [id, req.user.id, req.user.id, hold.rows.length ? 'held' : 'pending', now, now + DELETION_GRACE_MS],
      },
      {
        sql: `INSERT INTO deletion_profile_states (deletion_id, profile_id, was_published)
              SELECT ?, p.id, p.published FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
               WHERE w.owner_user_id = ? AND w.kind = 'personal'`,
        params: [id, req.user.id],
      },
      {
        sql: `UPDATE profiles SET published = 0, updated_at = ?
               WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_user_id = ? AND kind = 'personal')`,
        params: [now, req.user.id],
      },
      { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', params: [now, req.user.id, req.session.id] },
      { sql: 'UPDATE sessions SET reauth_at = NULL WHERE id = ?', params: [req.session.id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [req.user.id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [req.user.id] },
    ]);
  } catch {
    return res.status(409).render('error', { title: 'Deletion already pending', status: 409, message: 'This account already has an active deletion request.' });
  }
  await audit.record({ type: 'account.deletion_requested', actorUserId: req.user.id, subjectUserId: req.user.id, target: id, ipHash: ipPrefixHash(req), detail: { legalHold: hold.rows.length > 0 } });
  mail.securityNotice(req.user.email, 'Account deletion was requested. Profiles were unpublished immediately. You may cancel after fresh authentication during the 30-day grace period.').catch(() => {});
  res.redirect('/account/deletion');
});
router.post('/account/deletion/cancel', requireApproved, requireFreshAuth({ returnTo: '/account/deletion' }), async (req, res) => {
  if (req.body.confirmation !== 'CANCEL DELETION') {
    return res.status(400).render('error', { title: 'Deletion not cancelled', status: 400, message: 'Type CANCEL DELETION exactly to continue.' });
  }
  const deletion = (await db.query(
    "SELECT id FROM deletion_requests WHERE user_id = ? AND status IN ('pending', 'held') AND active_user_key = ? AND purge_after > ?",
    [req.user.id, req.user.id, Date.now()],
  )).rows[0];
  if (!deletion) return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'No cancellable deletion request exists.' });
  const now = Date.now();
  await db.batch([
    { sql: `UPDATE profiles SET published = (SELECT was_published FROM deletion_profile_states s WHERE s.deletion_id = ? AND s.profile_id = profiles.id), updated_at = ? WHERE id IN (SELECT profile_id FROM deletion_profile_states WHERE deletion_id = ?)`, params: [deletion.id, now, deletion.id] },
    { sql: "UPDATE deletion_requests SET status = 'cancelled', active_user_key = NULL, cancelled_at = ? WHERE id = ?", params: [now, deletion.id] },
  ]);
  await audit.record({ type: 'account.deletion_cancelled', actorUserId: req.user.id, subjectUserId: req.user.id, target: deletion.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'The pending account deletion was cancelled and eligible profile publication state was restored.').catch(() => {});
  res.redirect('/settings');
});
async function streamExport(res, userId, acceptedAt = Date.now()) {
  const data = await collectUserData(userId, { generatedAt: new Date(acceptedAt).toISOString() });
  const zip = buildExportZip(data);
  res.status(200);
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${exportFilename(acceptedAt)}"`,
    'Cache-Control': 'private, no-store',
  });
  zip.outputStream.pipe(res);
  zip.end();
}
router.get('/account/export', requireApproved, (req, res) => {
  res.render('account/export', {
    title: 'Download my data',
    linkSent: req.query.sent === '1',
  });
});
router.post(
  '/account/export/download',
  requireApproved,
  requireFreshAuth({ returnTo: '/account/export' }),
  async (req, res) => {
    const acceptedAt = Date.now();
    await audit.record({ type: 'data_export.downloaded', subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
    await streamExport(res, req.user.id, acceptedAt);
  },
);
router.post(
  '/account/export/link',
  requireApproved,
  requireFreshAuth({ returnTo: '/account/export' }),
  async (req, res) => {
    const limit = await consume('export_request', req.user.id);
    if (!limit.allowed) {
      return res.status(429).render('error', {
        title: 'Slow down',
        status: 429,
        message: 'Too many export requests. Try again later.',
      });
    }
    const now = Date.now();
    const token = newToken(32);
    const id = newId();
    await db.query(
      `INSERT INTO data_export_tokens
         (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, req.user.id, keyedHash(token), now + 14 * 24 * 60 * 60 * 1000, now],
    );
    const link = `${config.BASE_URL}/account/export/download/${token}`;
    await mail.dataExportLink(req.user.email, link, `data-export:${id}`);
    await audit.record({ type: 'data_export.link_requested', subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
    res.redirect('/account/export?sent=1');
  },
);
router.get('/account/export/download/:token', async (req, res) => {
  const notFound = () =>
    res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const now = Date.now();
  const tokenHash = keyedHash(String(req.params.token || ''));
  const candidate = await db.query(
    `SELECT t.id, t.user_id, t.created_at, t.used_at, t.expires_at, u.email
       FROM data_export_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.expires_at > ?`,
    [tokenHash, now],
  );
  const row = candidate.rows[0];
  if (!row) return notFound();
  const ban = await matchAccountBan({ userId: row.user_id, email: row.email, ip: clientIp(req) });
  if (ban) return notFound();
  if (row.used_at == null) {
    const activated = await db.query(
      `UPDATE data_export_tokens SET used_at = ?, expires_at = ?
      WHERE id = ? AND used_at IS NULL AND expires_at > ?
      RETURNING user_id`,
      [now, now + 7 * 24 * 60 * 60 * 1000, row.id, now],
    );
    if (activated.rows.length === 0) {
      const current = await db.query(
        'SELECT used_at, expires_at FROM data_export_tokens WHERE id = ? AND expires_at > ?',
        [row.id, now],
      );
      if (current.rows[0]?.used_at == null) return notFound();
    }
  }
  await audit.record({ type: 'data_export.link_downloaded', subjectUserId: row.user_id, ipHash: ipPrefixHash(req) });
  await streamExport(res, row.user_id, Number(row.created_at));
});
router.get('/account/reauth', requireApproved, async (req, res) => {
  const nextPath = reauth.safeNextPath(req.query.next);
  if (reauth.isFresh(req.session)) return res.redirect(nextPath);
  if (req.user.twofa_method === 'email') {
    const challenge = await reauth.createEmailChallenge(req.user.id, req.session.id);
    await mail.reauthEmail(req.user.email, challenge.code, `reauth:${challenge.id}`).catch(() => {});
  }
  res.render('account/reauth', { title: 'Confirm it is you', method: req.user.twofa_method, error: null, next: nextPath });
});
router.post('/account/reauth', requireApproved, async (req, res) => {
  const nextPath = reauth.safeNextPath(req.body.next);
  const fail = (error) =>
    res.status(401).render('account/reauth', { title: 'Confirm it is you', method: req.user.twofa_method, error, next: nextPath });
  const limit = await consume('reauth', req.user.id);
  if (!limit.allowed) {
    return res.status(429).render('error', { title: 'Slow down', status: 429, message: 'Too many attempts. Try again later.' });
  }
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(String(req.body.password || ''), rows[0].password_hash))) {
    return fail('Incorrect password or code.');
  }
  const submitted = String(req.body.code || '');
  let factorOk = false;
  if (req.user.twofa_method === 'totp') {
    const u = (
      await db.query(
        'SELECT totp_secret_ciphertext, totp_secret_nonce, totp_confirmed_at, totp_last_step FROM users WHERE id = ?',
        [req.user.id],
      )
    ).rows[0];
    if (u?.totp_confirmed_at && u.totp_secret_ciphertext) {
      const secret = decrypt(config.TOTP_ENCRYPTION_KEY, u.totp_secret_ciphertext, u.totp_secret_nonce);
      const lastUsedStep = u.totp_last_step == null ? null : Number(u.totp_last_step);
      const step = totp.verify(secret, submitted, { lastUsedStep });
      factorOk = step != null && (await totp.recordStep(req.user.id, step));
    }
    if (!factorOk && /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(submitted.trim())) {
      const consumed = await db.query(
        'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL RETURNING id',
        [Date.now(), req.user.id, keyedHash(submitted.trim().toLowerCase())],
      );
      factorOk = consumed.rows.length > 0;
    }
  } else {
    factorOk = (await reauth.verifyEmailCode(req.session.id, submitted)).ok;
  }
  if (!factorOk) return fail('Incorrect password or code.');
  await reauth.markFresh(req.session.id);
  await audit.record({ type: 'reauth.success', subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  res.redirect(nextPath);
});
function recoveryCodeSet(now = Date.now()) {
  const hex4 = () => randomBytes(2).toString('hex');
  const codes = Array.from({ length: 10 }, () => `${hex4()}-${hex4()}`);
  return {
    codes,
    statements: codes.map((code) => ({
      sql: 'INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
      params: [newId(), null, keyedHash(code), now],
    })),
  };
}
async function preserveCurrentSession(userId, sessionId) {
  await revokeAllForUser(userId);
  await db.query('UPDATE sessions SET revoked_at = NULL WHERE id = ? AND user_id = ?', [sessionId, userId]);
}
router.get('/account/security', requireApproved, requireFreshAuth(), async (req, res) => {
  const [sessions, codes] = await Promise.all([
    db.query(
      `SELECT id, created_at, last_seen_at, expires_at FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
      [req.user.id, Date.now()],
    ),
    db.query('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [req.user.id]),
  ]);
  res.render('account/security', {
    title: 'Security', method: req.user.twofa_method, error: null, step: 'overview',
    sessions: sessions.rows.map((row) => ({
      ...row, manageId: keyedHash(`session-management:v1:${row.id}`), current: row.id === req.session.id,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      lastSeenAt: new Date(Number(row.last_seen_at)).toISOString(),
    })),
    recoveryCodeCount: Number(codes.rows[0].count),
  });
});
router.post('/account/security/password', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  const password = String(req.body.password || '');
  if (password !== String(req.body.confirm_password || '')) {
    return res.status(400).render('error', { title: 'Password not changed', status: 400, message: 'The new passwords do not match.' });
  }
  const current = (await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id])).rows[0];
  if (await verifyPassword(password, current.password_hash)) {
    return res.status(400).render('error', { title: 'Password not changed', status: 400, message: 'Choose a password different from the current password.' });
  }
  let result;
  try {
    result = await hashPassword(password);
  } catch (error) {
    if (!(error instanceof PasswordPolicyError)) throw error;
    return res.status(400).render('error', { title: 'Password not changed', status: 400, message: error.message });
  }
  const now = Date.now();
  await db.batch([
    { sql: 'UPDATE users SET password_hash = ?, password_hash_version = ?, updated_at = ? WHERE id = ?', params: [result.hash, result.version, now, req.user.id] },
    { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [req.user.id] },
    { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [req.user.id] },
  ]);
  await preserveCurrentSession(req.user.id, req.session.id);
  await audit.record({ type: 'account.password_changed', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'Your account password was changed and other sessions were signed out.').catch(() => {});
  res.redirect('/account/security');
});
router.post('/account/security/email', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  let newEmail;
  try {
    newEmail = V.email(req.body.email, { field: 'New email' });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Email unchanged', status: 400, message: error.message });
  }
  if (newEmail === req.user.email) {
    return res.status(400).render('error', { title: 'Email unchanged', status: 400, message: 'Enter a different email address.' });
  }
  const [domainPolicy, ban, existing] = await Promise.all([
    evaluateEmailDomain(newEmail),
    matchAccountBan({ email: newEmail, ip: clientIp(req) }),
    db.query('SELECT id FROM users WHERE email = ?', [newEmail]),
  ]);
  if (!domainPolicy.ok || ban || existing.rows.length > 0) {
    return res.status(400).render('error', { title: 'Email unchanged', status: 400, message: 'That email address cannot be used.' });
  }
  const now = Date.now();
  const id = newId();
  const token = newToken(32);
  await db.batch([
    { sql: 'UPDATE email_change_requests SET used_at = ? WHERE user_id = ? AND used_at IS NULL', params: [now, req.user.id] },
    {
      sql: `INSERT INTO email_change_requests
              (id, user_id, old_email, new_email, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, req.user.id, req.user.email, newEmail, keyedHash(token), now + 60 * 60 * 1000, now],
    },
  ]);
  await mail.emailChangeVerification(newEmail, `${config.BASE_URL}/account/email-change/${token}`, `email-change:${id}`);
  await audit.record({ type: 'account.email_change_requested', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'A change to your account email address was requested. The current address remains active until the new address is confirmed.').catch(() => {});
  res.redirect('/account/security?email=pending');
});
router.get('/account/email-change/:token', async (req, res) => {
  const invalid = () => res.status(400).render('error', { title: 'Invalid link', status: 400, message: 'This email-change link is invalid or has expired.' });
  const now = Date.now();
  const { rows } = await db.query(
    `SELECT r.id, r.user_id, r.old_email, r.new_email
       FROM email_change_requests r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?
        AND u.email = r.old_email AND u.signup_status = 'approved'`,
    [keyedHash(req.params.token), now],
  );
  const request = rows[0];
  if (!request) return invalid();
  const [domainPolicy, ban, existing] = await Promise.all([
    evaluateEmailDomain(request.new_email),
    matchAccountBan({ userId: request.user_id, email: request.new_email, ip: clientIp(req) }),
    db.query('SELECT id FROM users WHERE email = ? AND id <> ?', [request.new_email, request.user_id]),
  ]);
  if (!domainPolicy.ok || ban || existing.rows.length > 0) return invalid();
  try {
    await db.batch([
      { sql: 'UPDATE email_change_requests SET used_at = ? WHERE id = ? AND used_at IS NULL', params: [now, request.id] },
      { sql: 'UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ? AND email = ?', params: [request.new_email, now, now, request.user_id, request.old_email] },
      { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, request.user_id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [request.user_id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [request.user_id] },
    ]);
  } catch {
    return invalid();
  }
  await audit.record({ type: 'account.email_changed', subjectUserId: request.user_id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(request.old_email, 'The email address on your account was changed.').catch(() => {});
  mail.securityNotice(request.new_email, 'This address is now the verified email for your account. All existing sessions were signed out.').catch(() => {});
  res.render('auth/verified', { title: 'Email changed' });
});
router.post('/account/security/sessions/:id/revoke', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  const sessions = await db.query('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [req.user.id]);
  const session = sessions.rows.find((row) => safeEqual(keyedHash(`session-management:v1:${row.id}`), req.params.id));
  if (!session) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  if (session.id === req.session.id) {
    return res.status(400).render('error', { title: 'Session not revoked', status: 400, message: 'Use Sign out to end the current session.' });
  }
  const result = await db.query(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL RETURNING id',
    [Date.now(), session.id, req.user.id],
  );
  if (result.rows.length === 0) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  await audit.record({ type: 'session.revoked', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  res.redirect('/account/security');
});
router.post('/account/security/sessions/revoke-others', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  await preserveCurrentSession(req.user.id, req.session.id);
  await audit.record({ type: 'session.others_revoked', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'All other account sessions were signed out.').catch(() => {});
  res.redirect('/account/security');
});
router.post('/account/security/totp/disable', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  if (req.user.twofa_method !== 'totp' || req.body.confirmation !== 'USE EMAIL CODES') {
    return res.status(400).render('error', { title: 'Two-factor method unchanged', status: 400, message: 'Type USE EMAIL CODES exactly to continue.' });
  }
  const now = Date.now();
  await db.batch([
    { sql: `UPDATE users SET twofa_method = 'email', totp_secret_ciphertext = NULL,
                  totp_secret_nonce = NULL, totp_key_version = NULL, totp_confirmed_at = NULL,
                  totp_last_step = NULL, updated_at = ? WHERE id = ?`, params: [now, req.user.id] },
    { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [req.user.id] },
    { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [req.user.id] },
  ]);
  await preserveCurrentSession(req.user.id, req.session.id);
  await audit.record({ type: 'twofa.switched_to_email', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'Two-factor authentication was switched from an authenticator app to email codes.').catch(() => {});
  res.redirect('/account/security');
});
router.post('/account/security/recovery-codes/regenerate', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  if (req.user.twofa_method !== 'totp' || req.body.confirmation !== 'REPLACE RECOVERY CODES') {
    return res.status(400).render('error', { title: 'Codes not changed', status: 400, message: 'Type REPLACE RECOVERY CODES exactly to continue.' });
  }
  const now = Date.now();
  const generated = recoveryCodeSet(now);
  generated.statements.forEach((statement) => { statement.params[1] = req.user.id; });
  await db.batch([{ sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [req.user.id] }, ...generated.statements]);
  await audit.record({ type: 'twofa.recovery_codes_regenerated', actorUserId: req.user.id, subjectUserId: req.user.id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(req.user.email, 'Authenticator recovery codes were replaced.').catch(() => {});
  res.render('account/recovery-codes', { title: 'Recovery codes', codes: generated.codes });
});
router.post('/account/security/totp/start', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  const secret = totp.generateSecret();
  const enc = encrypt(config.TOTP_ENCRYPTION_KEY, secret);
  const now = Date.now();
  await db.query(
    'UPDATE users SET totp_secret_ciphertext = ?, totp_secret_nonce = ?, totp_key_version = 1, totp_confirmed_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?',
    [enc.ciphertext, enc.nonce, now, req.user.id],
  );
  const otpauth = totp.otpauthUrl(secret, req.user.email);
  const qr = await QRCode.toDataURL(otpauth);
  res.render('account/security', { title: 'Security', method: req.user.twofa_method, error: null, step: 'confirm', qr, secret });
});
router.post('/account/security/totp/confirm', requireApproved, requireFreshAuth({ returnTo: '/account/security' }), async (req, res) => {
  const { rows } = await db.query(
    'SELECT totp_secret_ciphertext, totp_secret_nonce, totp_last_step FROM users WHERE id = ?',
    [req.user.id],
  );
  const u = rows[0];
  if (!u?.totp_secret_ciphertext) {
    return res.status(400).render('account/security', { title: 'Security', method: req.user.twofa_method, error: 'Start enrollment first.', step: 'overview' });
  }
  const secret = decrypt(config.TOTP_ENCRYPTION_KEY, u.totp_secret_ciphertext, u.totp_secret_nonce);
  const lastUsedStep = u.totp_last_step == null ? null : Number(u.totp_last_step);
  const confirmedStep = totp.verify(secret, String(req.body.code || ''), { lastUsedStep });
  if (confirmedStep == null || !(await totp.recordStep(req.user.id, confirmedStep))) {
    const otpauth = totp.otpauthUrl(secret, req.user.email);
    const qr = await QRCode.toDataURL(otpauth);
    return res.status(401).render('account/security', { title: 'Security', method: req.user.twofa_method, error: 'Incorrect code. Try again.', step: 'confirm', qr, secret });
  }
  const now = Date.now();
  const generated = recoveryCodeSet(now);
  const plainCodes = generated.codes;
  generated.statements.forEach((statement) => { statement.params[1] = req.user.id; });
  const statements = [
    { sql: "UPDATE users SET twofa_method = 'totp', totp_confirmed_at = ?, updated_at = ? WHERE id = ?", params: [now, now, req.user.id] },
    { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [req.user.id] },
    ...generated.statements,
  ];
  await db.batch(statements);
  await revokeAllForUser(req.user.id);
  if (req.session) await db.query('UPDATE sessions SET revoked_at = NULL WHERE id = ?', [req.session.id]);
  await audit.record({ type: 'twofa.totp_enrolled', subjectUserId: req.user.id });
  mail.securityNotice(req.user.email, 'Two-factor authentication was switched to an authenticator app (TOTP).').catch(() => {});
  res.render('account/recovery-codes', { title: 'Recovery codes', codes: plainCodes });
});
export default router;
