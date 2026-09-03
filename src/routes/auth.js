import express from 'express';
import config from '../config.js';
import db from '../db/index.js';
import audit from '../audit.js';
import * as altcha from '../altcha.js';
import { consume } from '../ratelimit.js';
import { ipPrefixHash, clientIp } from '../util/net.js';
import { newId, newToken, newNumericCode } from '../util/ids.js';
import { keyedHash, safeEqual, decrypt } from '../util/crypto.js';
import { publicPageHeaders } from '../middleware/security-headers.js';
import { hashPassword, verifyPassword, needsRehash, PasswordPolicyError, validatePolicy, PARAMS, CURRENT_VERSION } from '../auth/password.js';
import { hash as argon2Hash } from '@node-rs/argon2';
import * as V from '../validation.js';
import { evaluateEmailDomain } from '../email-domains.js';
import { ipPrefixTargetHash, matchAccountBan } from '../bans.js';
import * as mail from '../mail.js';
import { createSession, rotateSession, destroyBySessionId, clearSessionCookie, SESSION_COOKIE } from '../auth/session.js';
import { unsignValue } from '../util/cookies.js';
import * as verifyTotp from '../auth/totp.js';
import * as lc from '../auth/login-challenge.js';
import { firstProfileStatements } from '../profiles.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../policy.js';
const router = express.Router();
router.use(publicPageHeaders);
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = argon2Hash('timing-equalization-placeholder', { ...PARAMS[CURRENT_VERSION] });
  return dummyHashPromise;
}
export const ALTCHA_ENDPOINTS = ['signup', 'login', 'forgot_password'];
router.get('/altcha/challenge', async (req, res) => {
  const endpoint = String(req.query.for || '');
  if (!ALTCHA_ENDPOINTS.includes(endpoint)) return res.status(404).json({ error: 'unknown challenge' });
  const limit = await consume('altcha_challenge', ipPrefixHash(req) || 'unknown');
  if (!limit.allowed) return res.status(429).json({ error: 'too many challenges' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(await altcha.createChallenge(req, endpoint));
});
async function accountBanForUser(req, userId) {
  const { rows } = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
  const ban = await matchAccountBan({ userId, email: rows[0]?.email, ip: clientIp(req) });
  if (ban) await audit.record({ type: 'ban.login_blocked', subjectUserId: userId, target: ban.id });
  return ban;
}
async function hasActiveContentSuspension(userId) {
  const { rows } = await db.query(
    `SELECT id FROM content_suspensions
      WHERE user_id = ? AND active_user_key = ? AND status IN ('pending', 'extended')
      LIMIT 1`,
    [userId, userId],
  );
  return rows.length > 0;
}
router.get('/signup', (req, res) => {
  res.render('auth/signup', { title: 'Request an account', error: null, values: {} });
});
router.post('/signup', async (req, res) => {
  const renderError = (error, values = {}) =>
    res.status(400).render('auth/signup', { title: 'Request an account', error, values });
  const neutral = () => res.render('auth/check-email', { title: 'Check your email' });
  const ipHash = ipPrefixHash(req) || 'unknown';
  const limit = await consume('signup', ipHash);
  if (!limit.allowed) return res.status(429).render('error', { title: 'Slow down', status: 429, message: 'Too many attempts. Try again later.' });
  if (!(await altcha.verify(req, 'signup', req.body.altcha))) return renderError('Challenge failed. Please try again.', req.body);
  let email, uname, unameDisplay, displayName, reason;
  try {
    email = V.email(req.body.email);
    ({ key: uname, display: unameDisplay } = V.username(req.body.profile_username));
    displayName = V.displayText(req.body.display_name, { field: 'Display name', max: 80 });
    reason = V.reasonText(req.body.reason, { field: 'Signup reason', min: 20, max: 5000 });
  } catch (err) {
    if (err instanceof V.ValidationError) return renderError(err.message, req.body);
    throw err;
  }
  if (email === 'nobody@example.com') return renderError('Nobody already has a profile. See /u/nobody.', req.body);
  if (email === 'test@test.com') return renderError('This is production. Probably.', req.body);
  if (req.body.policies !== 'on') return renderError('You must agree to the Terms of Service and Privacy Policy.', req.body);
  if (req.body.age18 !== 'on') return renderError('You must attest that you are at least 18 years old.', req.body);
  const password = req.body.password;
  try {
    validatePolicy(password);
  } catch (err) {
    if (err instanceof PasswordPolicyError) return renderError(err.message, req.body);
    throw err;
  }
  const ban = await matchAccountBan({ email, ip: clientIp(req) });
  if (ban) return neutral();
  const domainPolicy = await evaluateEmailDomain(email);
  if (!domainPolicy.ok) return neutral();
  const existing = await db.query('SELECT 1 FROM users WHERE email = ?', [email]);
  if (existing.rows.length > 0) return neutral();
  const claimTaken = await db.query('SELECT 1 FROM public_username_claims WHERE username = ?', [uname]);
  if (claimTaken.rows.length > 0) return renderError('That username is unavailable.', req.body);
  const userCount = await db.query('SELECT COUNT(*) AS c FROM users');
  const isBootstrap = Number(userCount.rows[0].c) === 0;
  const signupStatus = isBootstrap ? 'approved' : 'pending';
  const { hash, version } = await hashPassword(password);
  const now = Date.now();
  const userId = newId();
  const verifyToken = newToken(32);
  const bootstrapProfile = isBootstrap
    ? firstProfileStatements({ userId, username: uname, usernameDisplay: unameDisplay, displayName, now })
    : null;
  try {
    await db.batch([
      {
        sql: `INSERT INTO users
                (id, email, password_hash, password_hash_version, signup_status,
                 requested_profile_username, requested_profile_username_display,
                 requested_display_name, request_note, requested_at, signup_ip_prefix_hash,
                 staff_role, twofa_method, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 'email', ?, ?)`,
        params: [userId, email, hash, version, signupStatus, uname, unameDisplay, displayName, reason, now, ipPrefixTargetHash(clientIp(req)), now, now],
      },
      {
        sql: `INSERT INTO public_username_claims (username, username_display, state, pending_user_id, requested_display_name, created_at)
              VALUES (?, ?, 'pending', ?, ?, ?)`,
        params: [uname, unameDisplay, userId, displayName, now],
      },
      {
        sql: `INSERT INTO policy_acceptances (id, user_id, terms_version, privacy_version, age_18_attested_at, accepted_at, keyed_ip_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [newId(), userId, TERMS_VERSION, PRIVACY_VERSION, now, now, ipHash],
      },
      {
        sql: `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
              VALUES (?, ?, 'verify_email', ?, ?, ?)`,
        params: [newId(), userId, keyedHash(verifyToken), now + VERIFY_TTL_MS, now],
      },
      ...(bootstrapProfile ? bootstrapProfile.statements : []),
    ]);
  } catch {
    return neutral();
  }
  await audit.record({ type: 'signup.created', subjectUserId: userId, ipHash, detail: { bootstrap: isBootstrap } });
  const link = `${config.BASE_URL}/verify-email?token=${verifyToken}`;
  await mail.verificationEmail(email, link, `verify:${userId}:${keyedHash(verifyToken).slice(0, 16)}`);
  return neutral();
});
router.get('/verify-email', async (req, res) => {
  const token = String(req.query.token || '');
  const now = Date.now();
  const invalid = () =>
    res.status(400).render('error', { title: 'Invalid link', status: 400, message: 'This verification link is invalid or has expired.' });
  const { rows } = await db.query(
    "SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > ?",
    [keyedHash(token), now],
  );
  const record = rows[0];
  if (!record) return invalid();
  const owner = await db.query('SELECT email, signup_status, email_verified_at FROM users WHERE id = ?', [record.user_id]);
  const ban = await matchAccountBan({ userId: record.user_id, email: owner.rows[0]?.email, ip: clientIp(req) });
  if (ban) {
    await audit.record({ type: 'ban.verification_blocked', subjectUserId: record.user_id, target: ban.id });
    return invalid();
  }
  await db.batch([
    { sql: 'UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', params: [now, record.id] },
    { sql: 'UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ? AND email_verified_at IS NULL', params: [now, now, record.user_id] },
  ]);
  await audit.record({ type: 'email.verified', subjectUserId: record.user_id });
  const firstVerification = owner.rows[0]?.email_verified_at == null;
  if (firstVerification && owner.rows[0]?.signup_status === 'pending') {
    mail.adminActionNeeded('pending_signup', `admin:signup:${record.user_id}`).catch(() => {});
  }
  res.render('auth/verified', { title: 'Email verified' });
});
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Reset your password', error: null,
  });
});
router.post('/forgot-password', async (req, res) => {
  const neutral = () => res.render('auth/password-reset-sent', { title: 'Check your email' });
  const ipHash = ipPrefixHash(req) || 'unknown';
  const ipLimit = await consume('password_reset_ip', ipHash);
  if (!ipLimit.allowed) {
    return res.status(429).render('error', { title: 'Slow down', status: 429, message: 'Too many attempts. Try again later.' });
  }
  if (!(await altcha.verify(req, 'forgot_password', req.body.altcha))) {
    return res.status(400).render('auth/forgot-password', {
      title: 'Reset your password', error: 'Challenge failed. Please try again.',
    });
  }
  let email;
  try {
    email = V.email(req.body.email);
  } catch (error) {
    if (error instanceof V.ValidationError) return neutral();
    throw error;
  }
  const accountLimit = await consume('password_reset_account', keyedHash(email));
  if (!accountLimit.allowed) return neutral();
  const { rows } = await db.query(
    `SELECT id, email, twofa_method FROM users
      WHERE email = ? AND signup_status = 'approved' AND email_verified_at IS NOT NULL`,
    [email],
  );
  const user = rows[0];
  if (!user || await matchAccountBan({ userId: user.id, email: user.email, ip: clientIp(req) })) return neutral();
  const now = Date.now();
  const token = newToken(32);
  const emailCode = newNumericCode();
  let secondCode = null;
  if (user.twofa_method === 'email') {
    do secondCode = newNumericCode(); while (secondCode === emailCode);
  }
  const challengeId = newId();
  await db.batch([
    { sql: 'UPDATE password_reset_challenges SET used = 1 WHERE user_id = ? AND used = 0', params: [user.id] },
    {
      sql: `INSERT INTO password_reset_challenges
              (id, user_id, token_hash, email_code_hash, second_code_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [challengeId, user.id, keyedHash(token), keyedHash(emailCode), secondCode ? keyedHash(secondCode) : null, now + PASSWORD_RESET_TTL_MS, now],
    },
  ]);
  await mail.passwordResetEmail(
    user.email, `${config.BASE_URL}/forgot-password/${token}`, emailCode, secondCode, `password-reset:${challengeId}`,
  );
  await audit.record({ type: 'account.password_reset_requested', subjectUserId: user.id, ipHash });
  return neutral();
});
async function passwordResetRecord(token, now = Date.now()) {
  const { rows } = await db.query(
    `SELECT c.id, c.user_id, c.email_code_hash, c.second_code_hash, c.attempts,
            u.email, u.twofa_method, u.totp_secret_ciphertext, u.totp_secret_nonce,
            u.totp_confirmed_at, u.totp_last_step
       FROM password_reset_challenges c JOIN users u ON u.id = c.user_id
      WHERE c.token_hash = ? AND c.used = 0 AND c.expires_at > ?
        AND u.signup_status = 'approved' AND u.email_verified_at IS NOT NULL`,
    [keyedHash(String(token || '')), now],
  );
  return rows[0] || null;
}
router.get('/forgot-password/:token', async (req, res) => {
  const reset = await passwordResetRecord(req.params.token);
  if (!reset) return res.status(404).render('error', { title: 'Invalid link', status: 404, message: 'This password-reset link is invalid or has expired.' });
  res.render('auth/password-reset', { title: 'Choose a new password', token: req.params.token, method: reset.twofa_method, error: null });
});
router.post('/forgot-password/:token', async (req, res) => {
  const invalid = () => res.status(400).render('error', { title: 'Invalid link', status: 400, message: 'This password-reset link is invalid or has expired.' });
  const reset = await passwordResetRecord(req.params.token);
  if (!reset) return invalid();
  const renderError = (error, status = 400) => res.status(status).render('auth/password-reset', {
    title: 'Choose a new password', token: req.params.token, method: reset.twofa_method, error,
  });
  const bumped = await db.query(
    'UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE id = ? AND used = 0 RETURNING attempts',
    [reset.id],
  );
  const attempts = Number(bumped.rows[0]?.attempts || PASSWORD_RESET_MAX_ATTEMPTS + 1);
  if (attempts > PASSWORD_RESET_MAX_ATTEMPTS) {
    await db.query('UPDATE password_reset_challenges SET used = 1 WHERE id = ?', [reset.id]);
    return renderError('Too many attempts. Request a new reset email.', 429);
  }
  const password = String(req.body.password || '');
  if (password !== String(req.body.confirm_password || '')) return renderError('The passwords do not match.');
  try {
    validatePolicy(password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) return renderError(error.message);
    throw error;
  }
  const emailOk = safeEqual(keyedHash(String(req.body.email_code || '')), reset.email_code_hash);
  let factorOk = false;
  const submitted = String(req.body.second_factor || '').trim();
  if (emailOk && reset.twofa_method === 'email') {
    factorOk = Boolean(reset.second_code_hash) && safeEqual(keyedHash(submitted), reset.second_code_hash);
  } else if (emailOk && reset.totp_confirmed_at && reset.totp_secret_ciphertext) {
    const secret = decrypt(config.TOTP_ENCRYPTION_KEY, reset.totp_secret_ciphertext, reset.totp_secret_nonce);
    const lastUsedStep = reset.totp_last_step == null ? null : Number(reset.totp_last_step);
    const step = verifyTotp.verify(secret, submitted, { lastUsedStep });
    factorOk = step != null && await verifyTotp.recordStep(reset.user_id, step);
  }
  if (emailOk && !factorOk && reset.twofa_method === 'totp' && /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(submitted)) {
    const consumed = await db.query(
      'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL RETURNING id',
      [Date.now(), reset.user_id, keyedHash(submitted.toLowerCase())],
    );
    factorOk = consumed.rows.length > 0;
    if (factorOk) await audit.record({ type: 'account.password_reset_recovery_code_used', subjectUserId: reset.user_id, ipHash: ipPrefixHash(req) });
  }
  if (!emailOk || !factorOk) return renderError('The email code or second factor is incorrect or expired.');
  if (await accountBanForUser(req, reset.user_id)) return invalid();
  const hashed = await hashPassword(password);
  const now = Date.now();
  const consumed = await db.query(
    'UPDATE password_reset_challenges SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ? RETURNING id',
    [reset.id, now],
  );
  if (consumed.rows.length === 0) return invalid();
  await db.batch([
    { sql: `UPDATE users SET password_hash = ?, password_hash_version = ?,
                   password_reset_required_at = NULL, password_reset_required_reason = NULL, updated_at = ?
             WHERE id = ?`, params: [hashed.hash, hashed.version, now, reset.user_id] },
    { sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, reset.user_id] },
    { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [reset.user_id] },
    { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [reset.user_id] },
    { sql: 'UPDATE password_reset_challenges SET used = 1 WHERE user_id = ? AND used = 0', params: [reset.user_id] },
  ]);
  clearSessionCookie(res);
  await audit.record({ type: 'account.password_reset_completed', subjectUserId: reset.user_id, ipHash: ipPrefixHash(req) });
  mail.securityNotice(reset.email, 'Your password was reset using email verification and your configured second factor. All sessions were signed out.').catch(() => {});
  res.render('auth/password-reset-complete', { title: 'Password reset complete' });
});
router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Sign in', error: null });
});
router.post('/login', async (req, res) => {
  const generic = () => res.status(401).render('auth/login', { title: 'Sign in', error: 'Incorrect email or password.' });
  const ipHash = ipPrefixHash(req) || 'unknown';
  const ipLimit = await consume('login_ip', ipHash);
  if (!ipLimit.allowed) return res.status(429).render('error', { title: 'Slow down', status: 429, message: 'Too many attempts. Try again later.' });
  if (!(await altcha.verify(req, 'login', req.body.altcha))) return generic();
  let email;
  try {
    email = V.email(req.body.email);
  } catch {
    await verifyPassword(String(req.body.password || ''), await dummyHash());
    return generic();
  }
  await consume('login_account', email);
  const ban = await matchAccountBan({ email, ip: clientIp(req) });
  if (ban) {
    await verifyPassword(String(req.body.password || ''), await dummyHash());
    return generic();
  }
  const { rows } = await db.query(
    'SELECT id, email, password_hash, password_hash_version, signup_status, twofa_method, email_verified_at FROM users WHERE email = ?',
    [email],
  );
  const user = rows[0];
  const ok = await verifyPassword(String(req.body.password || ''), user ? user.password_hash : await dummyHash());
  if (!user || !ok) return generic();
  if (user.signup_status === 'pending') {
    return res.status(403).render('auth/login', {
      title: 'Sign in',
      error: 'Your account is awaiting approval. You cannot sign in until it has been approved.',
    });
  }
  const eligible = user.signup_status === 'approved' && user.email_verified_at != null;
  if (!eligible) return generic();
  if (needsRehash(Number(user.password_hash_version))) {
    try {
      const rehashed = await hashPassword(String(req.body.password));
      await db.query('UPDATE users SET password_hash = ?, password_hash_version = ? WHERE id = ?', [rehashed.hash, rehashed.version, user.id]);
    } catch {
    }
  }
  if (user.twofa_method === 'totp') {
    const challenge = await lc.createTotpChallenge(user.id);
    lc.setPendingCookie(res, { challengeId: challenge.id, binding: '', userId: user.id });
    return res.redirect('/login/2fa');
  }
  const challenge = await lc.createEmailChallenge(user.id);
  lc.setPendingCookie(res, { challengeId: challenge.id, binding: challenge.binding, userId: user.id });
  const link = `${config.BASE_URL}/login/2fa/email-link/${challenge.magicToken}`;
  await mail.twofaEmail(user.email, challenge.code, link, `2fa:${challenge.id}`);
  res.redirect('/login/2fa');
});
router.get('/login/2fa', async (req, res) => {
  const pending = lc.readPending(req);
  if (!pending) return res.redirect('/login');
  const challenge = await lc.getActiveChallenge(pending.cid);
  if (!challenge) {
    lc.clearPendingCookie(res);
    return res.redirect('/login');
  }
  res.render('auth/twofa', { title: 'Enter your code', method: challenge.method, error: null });
});
router.post('/login/2fa', async (req, res) => {
  const pending = lc.readPending(req);
  if (!pending) return res.redirect('/login');
  const challenge = await lc.getActiveChallenge(pending.cid);
  if (!challenge) {
    lc.clearPendingCookie(res);
    return res.redirect('/login');
  }
  const attempts = await lc.bumpAttempts(challenge.id);
  if (attempts > lc.MAX_ATTEMPTS) {
    await lc.invalidateChallenge(challenge.id);
    lc.clearPendingCookie(res);
    return res.status(429).render('error', { title: 'Too many attempts', status: 429, message: 'Too many attempts. Start signing in again.' });
  }
  const fail = () => res.status(401).render('auth/twofa', { title: 'Enter your code', method: challenge.method, error: 'Incorrect or expired code.' });
  let verified = false;
  if (challenge.method === 'email') {
    verified = safeEqual(keyedHash(String(req.body.code || '')), challenge.code_hash);
  } else if (challenge.method === 'totp') {
    const { rows } = await db.query(
      'SELECT totp_secret_ciphertext, totp_secret_nonce, totp_confirmed_at, totp_last_step FROM users WHERE id = ?',
      [challenge.user_id],
    );
    const u = rows[0];
    const submitted = String(req.body.code || '');
    if (u?.totp_confirmed_at && u.totp_secret_ciphertext) {
      const { decrypt } = await import('../util/crypto.js');
      const secret = decrypt(config.TOTP_ENCRYPTION_KEY, u.totp_secret_ciphertext, u.totp_secret_nonce);
      const lastUsedStep = u.totp_last_step == null ? null : Number(u.totp_last_step);
      const step = verifyTotp.verify(secret, submitted, { lastUsedStep });
      verified = step != null && (await verifyTotp.recordStep(challenge.user_id, step));
    }
    if (!verified && /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(submitted.trim())) {
      const consumed = await db.query(
        'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL RETURNING id',
        [Date.now(), challenge.user_id, keyedHash(submitted.trim().toLowerCase())],
      );
      if (consumed.rows.length > 0) {
        verified = true;
        await audit.record({ type: 'login.recovery_code_used', subjectUserId: challenge.user_id, ipHash: ipPrefixHash(req) });
      }
    }
  }
  if (!verified) return fail();
  if (await accountBanForUser(req, challenge.user_id)) {
    await lc.invalidateChallenge(challenge.id);
    lc.clearPendingCookie(res);
    return fail();
  }
  if (!(await lc.consumeChallenge(challenge.id))) return fail();
  const restricted = await hasActiveContentSuspension(challenge.user_id);
  await rotateSession(req, res, challenge.user_id, { restricted });
  lc.clearPendingCookie(res);
  await audit.record({ type: 'login.success', subjectUserId: challenge.user_id, ipHash: ipPrefixHash(req) });
  const { rows } = await db.query('SELECT email FROM users WHERE id = ?', [challenge.user_id]);
  if (rows[0]) mail.securityNotice(rows[0].email, 'A new sign-in to your account was completed.').catch(() => {});
  res.redirect(restricted ? '/account/suspended' : '/dashboard');
});
router.get('/login/2fa/email-link/:token', async (req, res) => {
  const pending = lc.readPending(req);
  const returnToBrowser = () =>
    res.render('auth/magic-return', { title: 'Almost there' });
  if (!pending || !pending.b) return returnToBrowser();
  const challenge = await lc.getActiveChallenge(pending.cid);
  if (!challenge || challenge.method !== 'email') return returnToBrowser();
  const tokenOk = safeEqual(keyedHash(String(req.params.token || '')), challenge.magic_token_hash);
  const bindingOk = safeEqual(keyedHash(String(pending.b)), challenge.browser_binding_hash);
  if (!tokenOk || !bindingOk) return returnToBrowser();
  if (await accountBanForUser(req, challenge.user_id)) {
    await lc.invalidateChallenge(challenge.id);
    lc.clearPendingCookie(res);
    return returnToBrowser();
  }
  if (!(await lc.consumeChallenge(challenge.id))) return returnToBrowser();
  const restricted = await hasActiveContentSuspension(challenge.user_id);
  await rotateSession(req, res, challenge.user_id, { restricted });
  lc.clearPendingCookie(res);
  await audit.record({ type: 'login.success_magic', subjectUserId: challenge.user_id, ipHash: ipPrefixHash(req) });
  res.redirect(restricted ? '/account/suspended' : '/dashboard');
});
router.post('/logout', async (req, res) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  const token = raw ? unsignValue(config.COOKIE_SECRET, raw) : null;
  if (token) await destroyBySessionId(keyedHash(token));
  clearSessionCookie(res);
  res.redirect('/');
});
export default router;
