import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const DB_URL = process.env.NP_TEST_DATABASE_URL;
const skip = !DB_URL;
const secret = (s) => `${s}${'x'.repeat(Math.max(0, 32 - s.length))}`;
Object.assign(process.env, {
  NODE_ENV: 'test',
  BASE_URL: 'https://test.example.com',
  COOKIE_SECRET: secret('cookie-secret-'),
  POLICY_COOKIE_SECRET: secret('policy-secret-'),
  TOKEN_HASH_KEY: secret('token-hash-key-'),
  ALTCHA_HMAC_KEY: secret('altcha-hmac-key-'),
  ALTCHA_MAX_NUMBER: '4000',
  PASSWORD_PEPPER: '',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CONTENT_FLAG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DB_BACKEND: 'postgres',
  DATABASE_URL: DB_URL || 'postgres://u:p@localhost:5432/none',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Test <t@test.example.com>',
  ADMIN_NOTIFY_TO: 'Admin <admin@test.example.com>',
});
let server, base, db, outbox, ratelimit;
function jar() {
  const store = new Map();
  return {
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value === '' || /Expires=Thu, 01 Jan 1970/.test(c)) store.delete(name);
        else store.set(name, value);
      }
    },
  };
}
async function get(path, cookies) {
  const res = await fetch(`${base}${path}`, { headers: cookies ? { cookie: cookies.header() } : {}, redirect: 'manual' });
  if (cookies) cookies.absorb(res);
  return res;
}
async function post(path, body, cookies) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookies ? { cookie: cookies.header() } : {}) },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
  if (cookies) cookies.absorb(res);
  return res;
}
const ALTCHA_FORM_ENDPOINTS = { '/signup': 'signup', '/login': 'login', '/forgot-password': 'forgot_password' };
async function solveAltcha(html) {
  const action = Object.keys(ALTCHA_FORM_ENDPOINTS).find((path) => html.includes(`action="${path}"`));
  assert.ok(action, 'the page carries a form that needs a challenge');
  const res = await get(`/altcha/challenge?for=${ALTCHA_FORM_ENDPOINTS[action]}`);
  assert.equal(res.status, 200);
  const challenge = await res.json();
  let number = -1;
  for (let n = 0; n <= challenge.maxnumber; n++) {
    if (createHash('sha256').update(challenge.salt + n).digest('hex') === challenge.challenge) {
      number = n;
      break;
    }
  }
  return Buffer.from(
    JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature }),
  ).toString('base64');
}
before(async () => {
  if (skip) return;
  const { createApp } = await import('../src/server.js');
  db = (await import('../src/db/index.js')).default;
  outbox = (await import('../src/mail.js')).outbox;
  ratelimit = await import('../src/ratelimit.js');
  ratelimit._reset();
  await db.query('DELETE FROM altcha_challenges');
  const { rows } = await db.query('SELECT COUNT(*) AS c FROM users');
  if (Number(rows[0].c) === 0) {
    await insertUser({ email: `seed-${Date.now()}@seed.example`, password: 'seed-account-passphrase', status: 'approved' });
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  if (skip) return;
  ratelimit._reset();
});
after(async () => {
  if (skip) return;
  server.close();
  await db.close().catch(() => {});
});
test('full signup -> verify -> login -> email 2FA -> dashboard', { skip }, async () => {
  const cookies = jar();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `flow-${suffix}@allowed-${suffix}.example`;
  const password = 'a-sufficiently-long-passphrase';
  const uname = `flow${suffix}`.slice(0, 20);
  await get('/consent', cookies);
  let res = await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  assert.equal(res.status, 302);
  res = await get('/signup', cookies);
  const signupAltcha = await solveAltcha(await res.text());
  outbox.length = 0;
  res = await post(
    '/signup',
    { email, password, profile_username: uname, display_name: 'Flow Tester', reason: 'I want a personal profile.', policies: 'on', age18: 'on', altcha: signupAltcha },
    cookies,
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Check your email/);
  const userRow = await db.query('SELECT id, signup_status FROM users WHERE email = ?', [email]);
  assert.equal(userRow.rows.length, 1);
  const claim = await db.query('SELECT state FROM public_username_claims WHERE username = ?', [uname]);
  assert.equal(claim.rows[0].state, 'pending');
  const verifyMail = outbox.find((m) => m.to === email && /verify-email/.test(m.text));
  assert.ok(verifyMail, 'verification email sent');
  const verifyPath = /\/verify-email\?token=[^\s]+/.exec(verifyMail.text)[0];
  res = await get(verifyPath, cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /verified/i);
  await db.query('UPDATE users SET signup_status = ? WHERE email = ?', ['approved', email]);
  res = await get('/login', cookies);
  const loginAltcha = await solveAltcha(await res.text());
  outbox.length = 0;
  res = await post('/login', { email, password, altcha: loginAltcha }, cookies);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login/2fa');
  const codeMail = outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject));
  assert.ok(codeMail, '2FA email sent');
  const code = /code is:\s*(\d{6})/.exec(codeMail.text)[1];
  res = await post('/login/2fa', { code }, cookies);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/dashboard');
  res = await get('/dashboard', cookies);
  assert.equal(res.status, 200);
  const dashboard = await res.text();
  assert.doesNotMatch(dashboard, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(dashboard, /<altcha-widget[^>]+data-obfuscated=/);
});
test('server accepts a common password when the client deterrent is bypassed', { skip }, async () => {
  const cookies = jar();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `common-${suffix}@allowed-${suffix}.example`;
  await post('/consent', { policies: 'on', age18: 'on', next: '/signup' }, cookies);
  const page = await (await get('/signup', cookies)).text();
  const res = await post('/signup', {
    email,
    password: 'PolniyPizdec0211',
    profile_username: `common${suffix}`.slice(0, 20),
    display_name: 'Common Password Test',
    reason: 'I want a personal profile.',
    policies: 'on',
    age18: 'on',
    altcha: await solveAltcha(page),
  }, cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Check your email/i);
  assert.equal((await db.query('SELECT id FROM users WHERE email = ?', [email])).rows.length, 1);
});
async function loginAs(cookies, email, password) {
  await get('/consent', cookies);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  let res = await get('/login', cookies);
  const a = await solveAltcha(await res.text());
  outbox.length = 0;
  await post('/login', { email, password, altcha: a }, cookies);
  const codeMail = outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(codeMail.text)[1];
  await post('/login/2fa', { code }, cookies);
}
async function insertUser({ email, password, status = 'approved', role = 'none' }) {
  const { hashPassword } = await import('../src/auth/password.js');
  const { newId } = await import('../src/util/ids.js');
  const { hash, version } = await hashPassword(password);
  const now = Date.now();
  const id = newId();
  await db.query(
    `INSERT INTO users (id, email, password_hash, password_hash_version, email_verified_at, signup_status, staff_role, twofa_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'email', ?, ?)`,
    [id, email, hash, version, now, status, role, now, now],
  );
  return id;
}
test('self-service password reset requires two distinct email proofs and revokes sessions', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `password-reset-${suffix}@example.com`;
  const oldPassword = `old-reset-passphrase-${suffix}`;
  const newPassword = `new-reset-passphrase-${suffix}`;
  const userId = await insertUser({ email, password: oldPassword });
  const signedIn = jar();
  await loginAs(signedIn, email, oldPassword);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [userId])).rows[0].c), 1);
  const resetBrowser = jar();
  await get('/consent', resetBrowser);
  await post('/consent', { policies: 'on', age18: 'on', next: '/forgot-password' }, resetBrowser);
  let res = await get('/forgot-password', resetBrowser);
  outbox.length = 0;
  res = await post('/forgot-password', { email, altcha: await solveAltcha(await res.text()) }, resetBrowser);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Check your email/);
  const message = outbox.find((m) => m.to === email && /reset your account password/i.test(m.subject));
  assert.ok(message, 'password reset email sent');
  const resetPath = /\/forgot-password\/[A-Za-z0-9_-]+/.exec(message.text)[0];
  const emailCode = /email verification code is: (\d{6})/.exec(message.text)[1];
  const secondCode = /email two-factor code is: (\d{6})/.exec(message.text)[1];
  assert.notEqual(emailCode, secondCode);
  res = await post(resetPath, {
    email_code: emailCode,
    second_factor: secondCode === '000000' ? '000001' : '000000',
    password: newPassword,
    confirm_password: newPassword,
  }, resetBrowser);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /email code or second factor is incorrect/i);
  res = await post(resetPath, {
    email_code: emailCode,
    second_factor: secondCode,
    password: newPassword,
    confirm_password: newPassword,
  }, resetBrowser);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Password reset complete/);
  const { verifyPassword } = await import('../src/auth/password.js');
  const user = (await db.query('SELECT password_hash, password_hash_version, twofa_method FROM users WHERE id = ?', [userId])).rows[0];
  assert.equal(await verifyPassword(newPassword, user.password_hash, Number(user.password_hash_version)), true);
  assert.equal(await verifyPassword(oldPassword, user.password_hash, Number(user.password_hash_version)), false);
  assert.equal(user.twofa_method, 'email');
  assert.equal(Number((await db.query('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [userId])).rows[0].c), 0);
  res = await post(resetPath, { email_code: emailCode, second_factor: secondCode, password: newPassword, confirm_password: newPassword }, resetBrowser);
  assert.equal(res.status, 400);
});
async function freshen(cookies, email, password, next) {
  const res = await get(`/account/reauth?next=${encodeURIComponent(next)}`, cookies);
  const page = await res.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const message = [...outbox].reverse().find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(message.text)[1];
  await post('/account/reauth', { _csrf: csrf, password, code, next }, cookies);
}
test('admin approves a pending account (staff + CSRF + audit)', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `admin-${suffix}@allowed-${suffix}.example`;
  const pendingEmail = `pending-${suffix}@allowed-${suffix}.example`;
  const pw = 'admin-account-passphrase';
  await insertUser({ email: adminEmail, password: pw, status: 'approved', role: 'administrator' });
  const pendingId = await insertUser({ email: pendingEmail, password: pw, status: 'pending', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, adminEmail, pw);
  let res = await get('/admin', cookies);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, new RegExp(pendingEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /<altcha-widget[^>]+data-obfuscated=/);
  assert.match(html, /\/admin\/signups/, 'the overview points at the signup request queue');
  await freshen(cookies, adminEmail, pw, '/admin');
  const queue = await get('/admin/signups', cookies);
  assert.equal(queue.status, 200);
  const queueHtml = await queue.text();
  assert.doesNotMatch(queueHtml, new RegExp(pendingEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(queueHtml, new RegExp(`/admin/accounts/${pendingId}/approve`));
  const csrf = /name="_csrf" value="([^"]+)"/.exec(queueHtml)[1];
  res = await post(`/admin/accounts/${pendingId}/approve`, { _csrf: csrf }, cookies);
  assert.equal(res.status, 302);
  const after = await db.query('SELECT signup_status, decided_by FROM users WHERE id = ?', [pendingId]);
  assert.equal(after.rows[0].signup_status, 'approved');
  const noCsrf = await post(`/admin/accounts/${pendingId}/deny`, {}, cookies);
  assert.equal(noCsrf.status, 403);
});
test('an Administrator can delete an account, cancel it, and let the purge complete', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `deleter-${suffix}@allowed-${suffix}.example`;
  const targetEmail = `doomed-${suffix}@allowed-${suffix}.example`;
  const pw = 'admin-deletion-passphrase';
  await insertUser({ email: adminEmail, password: pw, status: 'approved', role: 'administrator' });
  const targetId = await insertUser({ email: targetEmail, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, adminEmail, pw);
  await freshen(cookies, adminEmail, pw, '/admin');
  const pageFor = async () => (await get(`/admin/accounts/${targetId}`, cookies)).text();
  let page = await pageFor();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  assert.match(page, new RegExp(`/admin/accounts/${targetId}/delete"`));

  let res = await post(`/admin/accounts/${targetId}/delete`, { _csrf: csrf, reason: 'Abusive account.' }, cookies);
  assert.equal(res.status, 400);
  assert.equal(
    (await db.query("SELECT COUNT(*) AS c FROM deletion_requests WHERE user_id = ?", [targetId])).rows[0].c,
    '0',
  );

  res = await post(
    `/admin/accounts/${targetId}/delete`,
    { _csrf: csrf, reason: 'Abusive account.', confirmation: 'DELETE ACCOUNT' },
    cookies,
  );
  assert.equal(res.status, 302);
  const scheduled = (await db.query(
    "SELECT id, status, purge_after FROM deletion_requests WHERE user_id = ? AND active_user_key = ?",
    [targetId, targetId],
  )).rows[0];
  assert.equal(scheduled.status, 'pending');
  assert.ok(Number(scheduled.purge_after) > Date.now(), 'the grace period is still open');
  assert.equal(
    (await db.query('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [targetId])).rows[0].c,
    '0',
    'every session of the deleted account was revoked',
  );

  page = await pageFor();
  assert.match(page, new RegExp(`/admin/accounts/${targetId}/delete/cancel`));
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(
    `/admin/accounts/${targetId}/delete/cancel`,
    { _csrf: csrf, reason: 'Appealed successfully.', confirmation: 'CANCEL DELETION' },
    cookies,
  );
  assert.equal(res.status, 302);
  assert.equal(
    (await db.query("SELECT status FROM deletion_requests WHERE id = ?", [scheduled.id])).rows[0].status,
    'cancelled',
  );

  page = await pageFor();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(
    `/admin/accounts/${targetId}/delete`,
    { _csrf: csrf, reason: 'Abusive account.', confirmation: 'DELETE ACCOUNT' },
    cookies,
  );
  assert.equal(res.status, 302);
  const again = (await db.query(
    "SELECT id, purge_after FROM deletion_requests WHERE user_id = ? AND active_user_key = ?",
    [targetId, targetId],
  )).rows[0];
  const { runMaintenance } = await import('../src/maintenance.js');
  await runMaintenance({ now: Number(again.purge_after) + 1000, log: () => {} });
  const purged = (await db.query('SELECT email, signup_status FROM users WHERE id = ?', [targetId])).rows[0];
  assert.match(purged.email, /@deleted\.invalid$/, 'the address is released and the record anonymised');
  assert.equal(purged.signup_status, 'terminated');
  assert.equal(
    (await db.query('SELECT status FROM deletion_requests WHERE id = ?', [again.id])).rows[0].status,
    'completed',
  );
});
test('an Administrator can delete an account immediately with no grace period', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `nuker-${suffix}@allowed-${suffix}.example`;
  const targetEmail = `instant-${suffix}@allowed-${suffix}.example`;
  const pw = 'admin-immediate-passphrase';
  await insertUser({ email: adminEmail, password: pw, status: 'approved', role: 'administrator' });
  const targetId = await insertUser({ email: targetEmail, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, adminEmail, pw);
  await freshen(cookies, adminEmail, pw, '/admin');
  let page = await (await get(`/admin/accounts/${targetId}`, cookies)).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  assert.match(page, new RegExp(`/admin/accounts/${targetId}/delete/now`));

  let res = await post(
    `/admin/accounts/${targetId}/delete/now`,
    { _csrf: csrf, reason: 'Illegal content.', confirmation: 'DELETE ACCOUNT' },
    cookies,
  );
  assert.equal(res.status, 400);
  assert.match((await db.query('SELECT email FROM users WHERE id = ?', [targetId])).rows[0].email, /@allowed-/);

  res = await post(
    `/admin/accounts/${targetId}/delete/now`,
    { _csrf: csrf, reason: 'Illegal content.', confirmation: 'DELETE IMMEDIATELY' },
    cookies,
  );
  assert.equal(res.status, 302);
  const purged = (await db.query('SELECT email, signup_status FROM users WHERE id = ?', [targetId])).rows[0];
  assert.equal(purged, undefined, 'the user row was deleted without waiting');
  assert.equal(
    (await db.query('SELECT COUNT(*) AS c FROM deletion_requests WHERE user_id = ?', [targetId])).rows[0].c,
    '0',
    'the deletion request was removed with the user',
  );
  assert.equal(
    (await db.query('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?', [targetId])).rows[0].c,
    '0',
  );
});
test('admin management covers roles, rules, bans, audit, reports, and emergency revocation', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const ownerEmail = `owner-admin-${suffix}@allowed-${suffix}.example`;
  const targetEmail = `managed-${suffix}@allowed-${suffix}.example`;
  const password = 'management-test-passphrase';
  await insertUser({ email: ownerEmail, password, role: 'owner' });
  const targetId = await insertUser({ email: targetEmail, password });
  const cookies = jar();
  await loginAs(cookies, ownerEmail, password);
  await freshen(cookies, ownerEmail, password, '/admin');
  let res = await get(`/admin?email=${encodeURIComponent(targetEmail)}`, cookies);
  let page = await res.text();
  assert.match(page, new RegExp(`/admin/accounts/${targetId}`));
  res = await get(`/admin/accounts/${targetId}`, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/accounts/${targetId}/role`, { _csrf: csrf, role: 'support', confirmation: 'CHANGE STAFF ROLE' }, cookies);
  assert.equal(res.status, 302);
  assert.equal((await db.query('SELECT staff_role FROM users WHERE id = ?', [targetId])).rows[0].staff_role, 'support');
  res = await get('/admin/users', cookies); page = await res.text();
  assert.equal(res.status, 200);
  assert.match(page, /User directory/);
  assert.match(page, new RegExp(`/admin/accounts/${targetId}`));
  assert.match(page, /support/);
  assert.doesNotMatch(page, new RegExp(targetEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  res = await get('/admin/email-rules', cookies); page = await res.text(); csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const domain = `blocked-${suffix}.example`;
  res = await post('/admin/email-rules', { _csrf: csrf, domain, rule_type: 'blocklist', confirmation: 'ADD EMAIL RULE' }, cookies);
  assert.equal(res.status, 302);
  const emailRule = (await db.query('SELECT id FROM email_domain_rules WHERE domain = ?', [domain])).rows[0];
  assert.ok(emailRule);
  res = await get('/admin/bans', cookies); page = await res.text(); csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post('/admin/bans', { _csrf: csrf, target_type: 'user', target: targetId, scope: 'account', reason: 'Account security incident', confirmation: 'CREATE BAN' }, cookies);
  assert.equal(res.status, 302);
  const ban = (await db.query('SELECT id FROM bans WHERE target_type = ? AND target_value = ? AND lifted_at IS NULL', ['user', targetId])).rows[0];
  assert.ok(ban);
  res = await post(`/admin/bans/${ban.id}/lift`, { _csrf: csrf, reason: 'Incident resolved safely', confirmation: 'LIFT BAN' }, cookies);
  assert.equal(res.status, 302);
  res = await post(`/admin/accounts/${targetId}/revoke-sessions`, { _csrf: csrf, confirmation: 'REVOKE ALL SESSIONS' }, cookies);
  assert.equal(res.status, 302);
  res = await get('/admin/reports', cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Operational reports/);
  res = await get(`/admin/audit?subject=${targetId}`, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.match(page, /staff\.role_changed/);
  assert.match(page, /account\.sessions_emergency_revoked/);
});
test('content-rule changes are immutable, previewed, and shadowed unless urgent', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `rule-admin-${suffix}@allowed-${suffix}.example`;
  const password = 'content-rule-admin-passphrase';
  const adminId = await insertUser({ email, password, status: 'approved', role: 'administrator' });
  const cookies = jar();
  await loginAs(cookies, email, password);
  let res = await get('/admin/content-rules/new', cookies);
  assert.equal(res.status, 302);
  res = await get('/account/reauth?next=/admin/content-rules/new', cookies);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = [...outbox].reverse().find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password, code, next: '/admin/content-rules/new' }, cookies);
  assert.equal(res.headers.get('location'), '/admin/content-rules/new');
  res = await get('/admin/content-rules/new', cookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const ruleId = `managed-rule-${suffix}`;
  const candidate = {
    _csrf: csrf, id: ruleId, type: 'exact_phrase', match: 'Bad Phrase', category: 'abuse',
    severity: 'warning', mode: 'enforcing', explanation: 'Managed test rule',
    should_match: 'A bad phrase here', should_not_match: 'A bad phrases here', reason: 'Add reviewed safety rule',
  };
  res = await post('/admin/content-rules/new', { ...candidate, action: 'save', confirmation: 'CREATE RULE' }, cookies);
  assert.equal(res.status, 400);
  assert.equal((await db.query('SELECT id FROM content_rules WHERE id = ?', [ruleId])).rows.length, 0);
  res = await post('/admin/content-rules/new', { ...candidate, action: 'preview' }, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.match(page, /7 days|seven days/i);
  assert.match(page, /1 positive and 1 negative tests passed/);
  let previewProof = /name="preview_proof" value="([^"]+)"/.exec(page)[1];
  res = await post('/admin/content-rules/new', { ...candidate, action: 'save', confirmation: 'CREATE RULE', preview_proof: previewProof }, cookies);
  assert.equal(res.status, 302);
  let versions = (await db.query(
    'SELECT version, mode, enforce_at, created_by FROM content_rule_versions WHERE rule_id = ? ORDER BY version',
    [ruleId],
  )).rows;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].mode, 'shadow');
  assert.ok(Number(versions[0].enforce_at) >= Date.now() + 6.9 * 24 * 60 * 60 * 1000);
  assert.equal(versions[0].created_by, adminId);
  res = await get(`/admin/content-rules/${ruleId}/edit`, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const urgent = {
    _csrf: csrf, id: ruleId, type: 'exact_phrase', match: 'Bad Phrase', category: 'abuse',
    severity: 'critical', mode: 'enforcing', urgent: 'on', explanation: 'Urgent managed test rule',
    should_match: 'bad phrase', should_not_match: 'bad phrasing', reason: 'Urgent documented safety threat',
  };
  res = await post(`/admin/content-rules/${ruleId}/edit`, { ...urgent, action: 'preview' }, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  previewProof = /name="preview_proof" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/content-rules/${ruleId}/edit`, { ...urgent, action: 'save', confirmation: 'CREATE VERSION', preview_proof: previewProof }, cookies);
  assert.equal(res.status, 302);
  versions = (await db.query(
    'SELECT id, version, mode, enforce_at, severity FROM content_rule_versions WHERE rule_id = ? ORDER BY version',
    [ruleId],
  )).rows;
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.map((row) => Number(row.version)), [1, 2]);
  assert.equal(versions[0].mode, 'shadow');
  assert.equal(versions[1].mode, 'enforcing');
  assert.equal(versions[1].enforce_at, null);
  assert.equal(versions[1].severity, 'critical');
  const parent = (await db.query('SELECT current_version_id FROM content_rules WHERE id = ?', [ruleId])).rows[0];
  assert.equal(parent.current_version_id, versions[1].id);
  res = await get('/admin/content-rules/import', cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const importedRuleId = `imported-rule-${suffix}`;
  const source = JSON.stringify({
    schemaVersion: 1,
    rules: [{
      id: importedRuleId, type: 'whole_token', match: 'ImportedBlock', category: 'abuse',
      severity: 'warning', mode: 'enforcing', explanation: 'Reviewed import',
      tests: { shouldMatch: ['An importedblock value'], shouldNotMatch: ['An importedblocks value'] },
    }],
  });
  res = await post('/admin/content-rules/import', { _csrf: csrf, source, reason: 'Import reviewed operator list', action: 'preview' }, cookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.match(page, /seven-day shadow then enforcing/);
  previewProof = /name="preview_proof" value="([^"]+)"/.exec(page)[1];
  res = await post('/admin/content-rules/import', {
    _csrf: csrf, source, reason: 'Import reviewed operator list', action: 'save', confirmation: 'IMPORT RULES', preview_proof: previewProof,
  }, cookies);
  assert.equal(res.status, 302);
  const imported = (await db.query(
    `SELECT v.mode, v.enforce_at, v.created_by FROM content_rules r
      JOIN content_rule_versions v ON v.id = r.current_version_id WHERE r.id = ?`,
    [importedRuleId],
  )).rows[0];
  assert.equal(imported.mode, 'shadow');
  assert.ok(Number(imported.enforce_at) >= Date.now() + 6.9 * 24 * 60 * 60 * 1000);
  assert.equal(imported.created_by, adminId);
  const events = await db.query(
    `SELECT event_type FROM audit_events WHERE actor_user_id = ? AND target = ?
      AND event_type IN ('content_rule.created', 'content_rule.version_created') ORDER BY created_at`,
    [adminId, ruleId],
  );
  assert.deepEqual(events.rows.map((row) => row.event_type), ['content_rule.created', 'content_rule.version_created']);
  assert.equal((await db.query(
    `SELECT COUNT(*) AS count FROM audit_events WHERE actor_user_id = ? AND target = ?
      AND event_type = 'content_rule.imported'`,
    [adminId, importedRuleId],
  )).rows[0].count, '1');
});
test('content flag review creates a narrow effective exemption', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const userEmail = `flag-user-${suffix}@allowed-${suffix}.example`;
  const adminEmail = `flag-admin-${suffix}@allowed-${suffix}.example`;
  const userPw = 'content-flag-user-passphrase';
  const adminPw = 'content-flag-admin-passphrase';
  const userId = await insertUser({ email: userEmail, password: userPw, status: 'approved' });
  const adminId = await insertUser({ email: adminEmail, password: adminPw, status: 'approved', role: 'administrator' });
  const { newId } = await import('../src/util/ids.js');
  const { encrypt, keyedHash } = await import('../src/util/crypto.js');
  const config = (await import('../src/config.js')).default;
  const ruleId = `review-rule-${suffix}`;
  const versionId = newId();
  const profileId = newId();
  const workspaceId = newId();
  const flagId = newId();
  const attemptedValue = `Blocked Phrase ${suffix}`;
  const encrypted = encrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, attemptedValue);
  const now = Date.now();
  await db.batch([
    { sql: 'INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [workspaceId, 'Flag Workspace', `flag-${suffix}`, 'personal', userId, now, now] },
    { sql: 'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)', params: [newId(), workspaceId, userId, 'owner', now] },
    { sql: 'INSERT INTO profiles (id, workspace_id, username, username_display, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [profileId, workspaceId, `flag${suffix}`.slice(0, 30).toLowerCase(), `Flag${suffix}`.slice(0, 30), 'Flag Profile', now, now] },
    { sql: 'INSERT INTO content_rules (id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?)', params: [ruleId, versionId, now, now] },
    { sql: `INSERT INTO content_rule_versions (id, rule_id, version, rule_type, match_value, category, severity, mode, explanation, created_at)
            VALUES (?, ?, 1, 'exact_field', ?, 'test_category', 'warning', 'enforcing', ?, ?)`, params: [versionId, ruleId, attemptedValue.toLowerCase(), 'Test explanation', now] },
    { sql: `INSERT INTO content_flags
              (id, user_id, profile_id, rule_version_id, field_type, attempted_ciphertext,
               attempted_nonce, idempotency_key_hash, policy_category, severity, mode,
               warned_at, created_at)
            VALUES (?, ?, ?, ?, 'display_name', ?, ?, ?, 'test_category', 'warning', 'enforcing', ?, ?)`,
      params: [flagId, userId, profileId, versionId, encrypted.ciphertext, encrypted.nonce, keyedHash(`flag-${suffix}`), now, now] },
  ]);
  const userCookies = jar();
  await loginAs(userCookies, userEmail, userPw);
  let res = await get('/account/content-flags', userCookies);
  assert.equal(res.status, 200);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/account/content-flags/${flagId}/review`, { _csrf: csrf, explanation: 'This exact value is a false positive' }, userCookies);
  assert.equal(res.status, 302);
  const review = (await db.query('SELECT id, status FROM content_flag_reviews WHERE flag_id = ?', [flagId])).rows[0];
  assert.equal(review.status, 'pending');
  const adminCookies = jar();
  await loginAs(adminCookies, adminEmail, adminPw);
  res = await get('/admin/content-flags', adminCookies);
  assert.equal(res.status, 302);
  res = await get('/account/reauth?next=/admin/content-flags', adminCookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = outbox.find((m) => m.to === adminEmail && /confirm a sensitive change/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password: adminPw, code, next: '/admin/content-flags' }, adminCookies);
  assert.equal(res.headers.get('location'), '/admin/content-flags');
  const adminWorkspaceId = newId();
  const adminProfileId = newId();
  const adminFlagId = newId();
  const adminAttemptedValue = attemptedValue;
  const adminEncrypted = encrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, adminAttemptedValue);
  await db.batch([
    { sql: 'INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [adminWorkspaceId, 'Admin Flag Workspace', `admin-flag-${suffix}`, 'personal', adminId, now, now] },
    { sql: 'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)', params: [newId(), adminWorkspaceId, adminId, 'owner', now] },
    { sql: 'INSERT INTO profiles (id, workspace_id, username, username_display, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [adminProfileId, adminWorkspaceId, `adminflag${suffix}`.slice(0, 30).toLowerCase(), `AdminFlag${suffix}`.slice(0, 30), 'Admin Flag Profile', now, now] },
    { sql: `INSERT INTO content_flags
              (id, user_id, profile_id, rule_version_id, field_type, attempted_ciphertext,
               attempted_nonce, idempotency_key_hash, policy_category, severity, mode,
               auto_suspension_eligible, warned_at, created_at)
            VALUES (?, ?, ?, ?, 'display_name', ?, ?, ?, 'test_category', 'warning',
                    'enforcing', 0, ?, ?)`,
      params: [adminFlagId, adminId, adminProfileId, versionId, adminEncrypted.ciphertext, adminEncrypted.nonce, keyedHash(`admin-flag-${suffix}`), now, now] },
  ]);
  res = await get(`/admin/content-flags/self/${adminFlagId}`, adminCookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.match(page, /Blocked Phrase/);
  assert.match(page, /immutable version 1/);
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/content-flags/self/${adminFlagId}`, {
    _csrf: csrf, scope: 'profile', expiry: '7', reason: 'Confirmed staff false positive', confirmation: 'WRONG',
  }, adminCookies);
  assert.equal(res.status, 400);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM content_rule_exemptions WHERE self_exemption = 1 AND created_by = ?', [adminId])).rows[0].count), 0);
  res = await post(`/admin/content-flags/self/${adminFlagId}`, {
    _csrf: csrf, scope: 'profile', expiry: '7', reason: 'Confirmed staff false positive', confirmation: 'CREATE EXEMPTION',
  }, adminCookies);
  assert.equal(res.status, 302);
  const selfExemption = (await db.query(
    'SELECT user_id, profile_id, expires_at, self_exemption FROM content_rule_exemptions WHERE self_exemption = 1 AND created_by = ?',
    [adminId],
  )).rows[0];
  assert.equal(selfExemption.user_id, adminId);
  assert.equal(selfExemption.profile_id, adminProfileId);
  assert.equal(selfExemption.self_exemption, 1);
  assert.ok(Number(selfExemption.expires_at) >= Date.now() + 6.9 * 24 * 60 * 60 * 1000);
  const selfDecided = (await db.query('SELECT status, auto_suspension_eligible FROM content_flags WHERE id = ?', [adminFlagId])).rows[0];
  assert.equal(selfDecided.status, 'exempted');
  assert.equal(selfDecided.auto_suspension_eligible, 0);
  const { matchIsExempt } = await import('../src/content-exemptions.js');
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue: adminAttemptedValue }, { userId: adminId, profileId: adminProfileId }), true);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue: 'Different Value' }, { userId: adminId, profileId: adminProfileId }), false);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue: adminAttemptedValue }, { userId: adminId, profileId: 'different-profile' }), false);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'notes', attemptedValue: adminAttemptedValue }, { userId: adminId, profileId: adminProfileId }), false);
  assert.equal(await matchIsExempt({ ruleVersionId: newId(), field: 'display_name', attemptedValue: adminAttemptedValue }, { userId: adminId, profileId: adminProfileId }), false);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue: adminAttemptedValue }, { userId, profileId: adminProfileId }), false);
  res = await get(`/admin/content-flags/${review.id}`, adminCookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.match(page, /Blocked Phrase/);
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/content-flags/${review.id}/decision`, { _csrf: csrf, action: 'exempted', reason: 'Confirmed narrow false positive.' }, adminCookies);
  assert.equal(res.status, 302);
  const decided = await db.query('SELECT status, decided_by FROM content_flags WHERE id = ?', [flagId]);
  assert.equal(decided.rows[0].status, 'exempted');
  assert.equal(decided.rows[0].decided_by, adminId);
  const exemption = await db.query('SELECT id, user_id, profile_id FROM content_rule_exemptions WHERE rule_version_id = ? AND self_exemption = 0', [versionId]);
  assert.equal(exemption.rows[0].user_id, userId);
  assert.equal(exemption.rows[0].profile_id, profileId);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue }, { userId, profileId }), true);
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue: 'Different Value' }, { userId, profileId }), false);
  res = await get(`/profiles/${profileId}/edit`, userCookies);
  assert.equal(res.status, 200);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const saveId = /name="_save_id" value="([^"]+)"/.exec(page)[1];
  res = await post(`/profiles/${profileId}/edit`, {
    _csrf: csrf, _save_id: saveId, display_name: attemptedValue, description: '', notes: '',
  }, userCookies);
  assert.equal(res.status, 302);
  const exemptionUse = await db.query(
    `SELECT id FROM audit_events
      WHERE event_type = 'content_rule.exemption_used' AND actor_user_id = ? AND target = ?`,
    [userId, (await db.query('SELECT id FROM content_rule_exemptions WHERE rule_version_id = ? AND self_exemption = 0', [versionId])).rows[0].id],
  );
  assert.equal(exemptionUse.rows.length, 1);
  res = await get('/admin/content-exemptions', adminCookies);
  assert.equal(res.status, 200);
  page = await res.text();
  assert.doesNotMatch(page, new RegExp(attemptedValue));
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/content-exemptions/${exemption.rows[0].id}`, {
    _csrf: csrf, action: 'revoke', reason: 'False positive scope retired', confirmation: 'REVOKE EXEMPTION',
  }, adminCookies);
  assert.equal(res.status, 302);
  const revoked = (await db.query(
    'SELECT revoked_at, revoked_by, revoke_reason FROM content_rule_exemptions WHERE id = ?',
    [exemption.rows[0].id],
  )).rows[0];
  assert.ok(Number(revoked.revoked_at) > 0);
  assert.equal(revoked.revoked_by, adminId);
  assert.equal(revoked.revoke_reason, 'False positive scope retired');
  assert.equal(await matchIsExempt({ ruleVersionId: versionId, field: 'display_name', attemptedValue }, { userId, profileId }), false);
});
test('three distinct enforcing edits suspend and Administrator restoration recovers access', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `suspend-${suffix}@allowed-${suffix}.example`;
  const adminEmail = `suspend-admin-${suffix}@allowed-${suffix}.example`;
  const pw = 'suspension-user-passphrase';
  const adminPw = 'suspension-admin-passphrase';
  const userId = await insertUser({ email, password: pw, status: 'approved' });
  await insertUser({ email: adminEmail, password: adminPw, status: 'approved', role: 'administrator' });
  const { newId } = await import('../src/util/ids.js');
  const workspaceId = newId();
  const profileId = newId();
  const ruleId = `suspend-rule-${suffix}`;
  const versionId = newId();
  const blockedValue = `Blocked ${suffix}`;
  const now = Date.now();
  await db.batch([
    { sql: 'INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [workspaceId, 'Suspend Workspace', `suspend-${suffix}`, 'personal', userId, now, now] },
    { sql: 'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)', params: [newId(), workspaceId, userId, 'owner', now] },
    { sql: 'INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', params: [profileId, workspaceId, `suspend${suffix}`.slice(0, 30).toLowerCase(), `Suspend${suffix}`.slice(0, 30), 'Safe Name', now, now] },
    { sql: 'INSERT INTO content_rules (id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?)', params: [ruleId, versionId, now, now] },
    { sql: `INSERT INTO content_rule_versions
              (id, rule_id, version, rule_type, match_value, category, severity, mode, explanation, created_at)
            VALUES (?, ?, 1, 'exact_field', ?, 'test_category', 'warning', 'enforcing', 'Test rule', ?)`, params: [versionId, ruleId, blockedValue.toLowerCase(), now] },
  ]);
  const cookies = jar();
  await loginAs(cookies, email, pw);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res = await get(`/profiles/${profileId}/edit`, cookies);
    assert.equal(res.status, 200);
    const page = await res.text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
    const saveId = /name="_save_id" value="([^"]+)"/.exec(page)[1];
    res = await post(`/profiles/${profileId}/edit`, {
      _csrf: csrf,
      _save_id: saveId,
      display_name: blockedValue,
      description: '',
      notes: '',
      published: 'on',
    }, cookies);
    assert.equal(res.status, 422, `attempt ${attempt} is reverted`);
    if (attempt === 1) {
      res = await post(`/profiles/${profileId}/edit`, {
        _csrf: csrf,
        _save_id: saveId,
        display_name: blockedValue,
        description: '',
        notes: '',
        published: 'on',
      }, cookies);
      assert.equal(res.status, 422);
      assert.equal((await db.query('SELECT id FROM content_suspensions WHERE user_id = ?', [userId])).rows.length, 0);
    }
  }
  const suspension = (await db.query('SELECT id, status, threshold_count FROM content_suspensions WHERE user_id = ?', [userId])).rows[0];
  assert.equal(suspension.status, 'pending');
  assert.equal(Number(suspension.threshold_count), 3);
  const profile = await db.query('SELECT published, display_name FROM profiles WHERE id = ?', [profileId]);
  assert.equal(Number(profile.rows[0].published), 0, 'personal profile unpublished');
  assert.equal(profile.rows[0].display_name, 'Safe Name', 'rejected value never saved');
  const flags = await db.query('SELECT COUNT(DISTINCT idempotency_key_hash) AS c FROM content_flags WHERE user_id = ?', [userId]);
  assert.equal(Number(flags.rows[0].c), 3);
  const reviewedFlagId = (await db.query('SELECT id FROM content_flags WHERE user_id = ? ORDER BY created_at LIMIT 1', [userId])).rows[0].id;
  const suspensionReviewId = newId();
  await db.query(
    `INSERT INTO content_flag_reviews (id, flag_id, requested_by, explanation, requested_at)
     VALUES (?, ?, ?, 'Please review this flag', ?)`,
    [suspensionReviewId, reviewedFlagId, userId, now],
  );
  const restricted = jar();
  outbox.length = 0;
  await passwordStep(restricted, email, pw);
  const loginMail = outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject));
  const loginCode = /code is:\s*(\d{6})/.exec(loginMail.text)[1];
  let res = await post('/login/2fa', { code: loginCode }, restricted);
  assert.equal(res.headers.get('location'), '/account/suspended');
  res = await get('/dashboard', restricted);
  assert.equal(res.headers.get('location'), '/account/suspended');
  res = await get('/account/content-flags', restricted);
  assert.equal(res.status, 200, 'restricted session may use the review flow');
  const adminCookies = jar();
  await loginAs(adminCookies, adminEmail, adminPw);
  res = await get('/admin/suspensions', adminCookies);
  assert.equal(res.status, 302);
  outbox.length = 0;
  res = await get('/account/reauth?next=/admin/suspensions', adminCookies);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = outbox.find((m) => m.to === adminEmail && /confirm a sensitive change/i.test(m.subject));
  const reauthCode = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  await post('/account/reauth', { _csrf: csrf, password: adminPw, code: reauthCode, next: '/admin/suspensions' }, adminCookies);
  res = await get('/admin/suspensions', adminCookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/suspensions/${suspension.id}/decision`, {
    _csrf: csrf,
    action: 'restored',
    reason: 'Reviewed and restored with a warning.',
  }, adminCookies);
  assert.equal(res.status, 302);
  const restoredSuspension = await db.query('SELECT status, active_user_key FROM content_suspensions WHERE id = ?', [suspension.id]);
  assert.equal(restoredSuspension.rows[0].status, 'restored');
  assert.equal(restoredSuspension.rows[0].active_user_key, null);
  assert.equal((await db.query('SELECT status FROM content_flag_reviews WHERE id = ?', [suspensionReviewId])).rows[0].status, 'upheld');
  assert.equal(Number((await db.query('SELECT published FROM profiles WHERE id = ?', [profileId])).rows[0].published), 1);
  assert.equal((await get('/account/content-flags', restricted)).status, 302, 'old restricted session was revoked');
  const normalAgain = jar();
  outbox.length = 0;
  await passwordStep(normalAgain, email, pw);
  const nextMail = outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject));
  res = await post('/login/2fa', { code: /code is:\s*(\d{6})/.exec(nextMail.text)[1] }, normalAgain);
  assert.equal(res.headers.get('location'), '/dashboard');
  await db.query('UPDATE content_flags SET auto_suspension_eligible = 0 WHERE user_id = ?', [userId]);
  await db.query("UPDATE content_rule_versions SET severity = 'critical' WHERE id = ?", [versionId]);
  res = await get(`/profiles/${profileId}/edit`, normalAgain);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const criticalSaveId = /name="_save_id" value="([^"]+)"/.exec(page)[1];
  res = await post(`/profiles/${profileId}/edit`, {
    _csrf: csrf,
    _save_id: criticalSaveId,
    display_name: blockedValue,
    description: '',
    notes: '',
    published: 'on',
  }, normalAgain);
  assert.equal(res.status, 422);
  const criticalSuspension = await db.query(
    "SELECT id, threshold_count FROM content_suspensions WHERE user_id = ? AND status = 'pending'",
    [userId],
  );
  assert.equal(Number(criticalSuspension.rows[0].threshold_count), 1, 'critical match suspends immediately');
  res = await get('/admin/suspensions', adminCookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post(`/admin/suspensions/${criticalSuspension.rows[0].id}/decision`, {
    _csrf: csrf, action: 'extended', reason: 'Repeated prohibited submissions', confirmation: 'WRONG',
  }, adminCookies);
  assert.equal(res.status, 400);
  res = await post(`/admin/suspensions/${criticalSuspension.rows[0].id}/decision`, {
    _csrf: csrf, action: 'extended', reason: 'Repeated prohibited submissions', confirmation: 'EXTEND SUSPENSION',
  }, adminCookies);
  assert.equal(res.status, 302);
  let highImpact = (await db.query('SELECT status, active_user_key FROM content_suspensions WHERE id = ?', [criticalSuspension.rows[0].id])).rows[0];
  assert.equal(highImpact.status, 'extended');
  assert.equal(highImpact.active_user_key, userId);
  assert.equal((await get('/dashboard', normalAgain)).status, 302, 'full session revoked by staff suspension');
  res = await post(`/admin/suspensions/${criticalSuspension.rows[0].id}/decision`, {
    _csrf: csrf, action: 'banned', ban_scope: 'both', reason: 'Account ban after reviewed violations', confirmation: 'BAN ACCOUNT',
  }, adminCookies);
  assert.equal(res.status, 302);
  highImpact = (await db.query('SELECT status, active_user_key FROM content_suspensions WHERE id = ?', [criticalSuspension.rows[0].id])).rows[0];
  assert.equal(highImpact.status, 'banned');
  assert.equal(highImpact.active_user_key, null);
  const { matchAccountBan } = await import('../src/bans.js');
  assert.ok(await matchAccountBan({ userId, email, ip: '127.0.0.1' }));
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'ban.created' AND subject_user_id = ?", [userId])).rows[0].count, '1');
  const terminatedId = await insertUser({
    email: `terminated-${suffix}@allowed-${suffix}.example`, password: pw, status: 'approved',
  });
  const { encrypt, keyedHash } = await import('../src/util/crypto.js');
  const config = (await import('../src/config.js')).default;
  const terminalFlagId = newId();
  const terminalSuspensionId = newId();
  const terminalEncrypted = encrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, blockedValue);
  await db.batch([
    {
      sql: `INSERT INTO content_flags
              (id, user_id, rule_version_id, field_type, attempted_ciphertext, attempted_nonce,
               idempotency_key_hash, policy_category, severity, mode, warned_at, created_at)
            VALUES (?, ?, ?, 'display_name', ?, ?, ?, 'test_category', 'warning', 'enforcing', ?, ?)`,
      params: [terminalFlagId, terminatedId, versionId, terminalEncrypted.ciphertext, terminalEncrypted.nonce, keyedHash(`terminate-${suffix}`), now, now],
    },
    {
      sql: `INSERT INTO content_suspensions
              (id, user_id, trigger_flag_id, active_user_key, threshold_count, window_hours, created_at)
            VALUES (?, ?, ?, ?, 3, 24, ?)`,
      params: [terminalSuspensionId, terminatedId, terminalFlagId, terminatedId, now],
    },
  ]);
  res = await post(`/admin/suspensions/${terminalSuspensionId}/decision`, {
    _csrf: csrf, action: 'terminated', reason: 'Account terminated after reviewed violations', confirmation: 'TERMINATE ACCOUNT',
  }, adminCookies);
  assert.equal(res.status, 302);
  assert.equal((await db.query('SELECT status FROM content_suspensions WHERE id = ?', [terminalSuspensionId])).rows[0].status, 'terminated');
  const terminatedUser = (await db.query('SELECT signup_status, staff_role FROM users WHERE id = ?', [terminatedId])).rows[0];
  assert.equal(terminatedUser.signup_status, 'terminated');
  assert.equal(terminatedUser.staff_role, 'none');
  assert.equal((await db.query('SELECT status FROM content_flags WHERE id = ?', [terminalFlagId])).rows[0].status, 'upheld');
});
test('TOTP enrollment then TOTP-only login', { skip }, async () => {
  const { generate } = await import('../src/auth/totp.js');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `totp-${suffix}@allowed-${suffix}.example`;
  const pw = 'totp-user-passphrase-xx';
  await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, email, pw);
  let res = await get('/account/security', cookies);
  assert.equal(res.status, 302);
  res = await get('/account/reauth?next=/account/security', cookies);
  let csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  const reauthMail = outbox.find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  const reauthCode = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password: pw, code: reauthCode, next: '/account/security' }, cookies);
  assert.equal(res.headers.get('location'), '/account/security');
  res = await get('/account/security', cookies);
  csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  res = await post('/account/security/totp/start', { _csrf: csrf }, cookies);
  assert.equal(res.status, 200);
  const startHtml = await res.text();
  const secret = /Manual key: <code>([^<]+)<\/code>/.exec(startHtml)[1];
  csrf = /name="_csrf" value="([^"]+)"/.exec(startHtml)[1];
  const confirmCode = generate(secret);
  res = await post('/account/security/totp/confirm', { _csrf: csrf, code: confirmCode }, cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Recovery codes|recovery codes/i);
  const urow = await db.query('SELECT twofa_method FROM users WHERE email = ?', [email]);
  assert.equal(urow.rows[0].twofa_method, 'totp');
  const rc = await db.query('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)', [email]);
  assert.equal(Number(rc.rows[0].c), 10);
  await post('/logout', { _csrf: csrf }, cookies);
  const jar2 = jar();
  await get('/consent', jar2);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, jar2);
  res = await get('/login', jar2);
  const a = await solveAltcha(await res.text());
  outbox.length = 0;
  res = await post('/login', { email, password: pw, altcha: a }, jar2);
  assert.equal(res.headers.get('location'), '/login/2fa');
  assert.equal(outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject)), undefined, 'no email code for TOTP account');
  res = await get('/login/2fa', jar2);
  assert.match(await res.text(), /authenticator/i);
  const spent = await post('/login/2fa', { code: confirmCode }, jar2);
  assert.equal(spent.status, 401, 'the confirmation code cannot be reused to sign in');
  res = await post('/login/2fa', { code: generate(secret, Date.now() + 30_000) }, jar2);
  assert.equal(res.headers.get('location'), '/dashboard');
  const codeRow = await db.query(
    'SELECT code_hash FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?) AND used_at IS NULL LIMIT 1',
    [email],
  );
  assert.ok(codeRow.rows.length > 0);
  const { keyedHash } = await import('../src/util/crypto.js');
  const { newId } = await import('../src/util/ids.js');
  const known = 'abcd-1234';
  const uid = (await db.query('SELECT id FROM users WHERE email = ?', [email])).rows[0].id;
  await db.query('INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)', [newId(), uid, keyedHash(known), Date.now()]);
  const jar3 = jar();
  await get('/consent', jar3);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, jar3);
  const a3 = await solveAltcha(await (await get('/login', jar3)).text());
  await post('/login', { email, password: pw, altcha: a3 }, jar3);
  const rec1 = await post('/login/2fa', { code: known }, jar3);
  assert.equal(rec1.headers.get('location'), '/dashboard', 'recovery code accepted once');
  const jar4 = jar();
  await get('/consent', jar4);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, jar4);
  const a4 = await solveAltcha(await (await get('/login', jar4)).text());
  await post('/login', { email, password: pw, altcha: a4 }, jar4);
  const rec2 = await post('/login/2fa', { code: known }, jar4);
  assert.equal(rec2.status, 401, 'reused recovery code rejected');
});
async function enrollTotpDirectly(userId, secret) {
  const config = (await import('../src/config.js')).default;
  const { encrypt } = await import('../src/util/crypto.js');
  const enc = encrypt(config.TOTP_ENCRYPTION_KEY, secret);
  const now = Date.now();
  await db.query(
    `UPDATE users SET twofa_method = 'totp', totp_secret_ciphertext = ?, totp_secret_nonce = ?,
       totp_key_version = 1, totp_confirmed_at = ?, totp_last_step = NULL, updated_at = ? WHERE id = ?`,
    [enc.ciphertext, enc.nonce, now, now, userId],
  );
}
async function passwordStep(cookies, email, password) {
  await get('/consent', cookies);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  const a = await solveAltcha(await (await get('/login', cookies)).text());
  return post('/login', { email, password, altcha: a }, cookies);
}
test('a used TOTP code cannot be replayed on a second login', { skip }, async () => {
  const { generateSecret, generate, currentStep } = await import('../src/auth/totp.js');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `replay-${suffix}@allowed-${suffix}.example`;
  const pw = 'replay-user-passphrase-x';
  const userId = await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const secret = generateSecret();
  await enrollTotpDirectly(userId, secret);
  const code = generate(secret);
  const first = jar();
  await passwordStep(first, email, pw);
  const ok = await post('/login/2fa', { code }, first);
  assert.equal(ok.headers.get('location'), '/dashboard', 'first use of the code authenticates');
  const stored = await db.query('SELECT totp_last_step FROM users WHERE id = ?', [userId]);
  assert.equal(Number(stored.rows[0].totp_last_step), currentStep());
  const second = jar();
  await passwordStep(second, email, pw);
  const replay = await post('/login/2fa', { code }, second);
  assert.equal(replay.status, 401, 'replayed TOTP code rejected');
});
test('an Account ban blocks email verification without disclosing the ban', { skip }, async () => {
  const { createBan } = await import('../src/bans.js');
  const cookies = jar();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `banned-${suffix}@allowed-${suffix}.example`;
  const password = 'banned-user-passphrase-x';
  const uname = `banned${suffix}`.slice(0, 20);
  await get('/consent', cookies);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  const a = await solveAltcha(await (await get('/signup', cookies)).text());
  outbox.length = 0;
  await post('/signup', { email, password, profile_username: uname, display_name: 'Banned Tester', reason: 'I want a personal profile.', policies: 'on', age18: 'on', altcha: a }, cookies);
  const verifyMail = outbox.find((m) => m.to === email && /verify-email/.test(m.text));
  const verifyPath = /\/verify-email\?token=[^\s]+/.exec(verifyMail.text)[0];
  await createBan({ type: 'email', value: email, scope: 'account', reason: 'test' });
  const res = await get(verifyPath, cookies);
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /invalid or has expired/i);
  assert.doesNotMatch(html, /ban/i, 'the response never names a ban');
  const row = await db.query('SELECT email_verified_at FROM users WHERE email = ?', [email]);
  assert.equal(row.rows[0].email_verified_at, null, 'the account stays unverified');
  const token = await db.query(
    "SELECT used_at FROM email_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) AND purpose = 'verify_email'",
    [email],
  );
  assert.equal(token.rows[0].used_at, null, 'the token is not consumed');
});
test('support is a valid staff role in the schema', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `support-${suffix}@allowed-${suffix}.example`;
  const id = await insertUser({ email, password: 'support-user-passphrase', status: 'approved', role: 'support' });
  const row = await db.query('SELECT staff_role FROM users WHERE id = ?', [id]);
  assert.equal(row.rows[0].staff_role, 'support');
});
test('non-staff cannot reach /admin (404, no existence leak)', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `plain-${suffix}@allowed-${suffix}.example`;
  const pw = 'plain-user-passphrase-xx';
  await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, email, pw);
  const res = await get('/admin', cookies);
  assert.equal(res.status, 404);
});
test('sensitive action needs a fresh step-up (email second factor)', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `fresh-${suffix}@allowed-${suffix}.example`;
  const pw = 'freshness-user-passphrase';
  const userId = await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, email, pw);
  let res = await get('/account/security', cookies);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/account\/reauth\?next=%2Faccount%2Fsecurity$/);
  outbox.length = 0;
  res = await get('/account/reauth?next=/account/security', cookies);
  assert.equal(res.status, 200);
  const page = await res.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const codeMail = outbox.find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  assert.ok(codeMail, 'reauth code email sent');
  const code = /code is:\s*(\d{6})/.exec(codeMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password: 'not-the-password', code, next: '/account/security' }, cookies);
  assert.equal(res.status, 401);
  res = await post('/account/reauth', { _csrf: csrf, password: pw, code, next: '/account/security' }, cookies);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/account/security');
  res = await get('/account/security', cookies);
  assert.equal(res.status, 200);
  res = await post('/account/reauth', { _csrf: csrf, password: pw, code, next: '/account/security' }, cookies);
  assert.equal(res.status, 401, 'a consumed reauth code is dead');
  const stale = Date.now() - 11 * 60 * 1000;
  await db.query('UPDATE sessions SET reauth_at = ? WHERE user_id = ?', [stale, userId]);
  res = await get('/account/security', cookies);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/account\/reauth/);
});
test('step-up with a TOTP second factor (no email sent)', { skip }, async () => {
  const { generateSecret, generate } = await import('../src/auth/totp.js');
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `freshtotp-${suffix}@allowed-${suffix}.example`;
  const pw = 'freshness-totp-passphrase';
  const userId = await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const secret = generateSecret();
  await enrollTotpDirectly(userId, secret);
  const cookies = jar();
  await passwordStep(cookies, email, pw);
  let res = await post('/login/2fa', { code: generate(secret) }, cookies);
  assert.equal(res.headers.get('location'), '/dashboard');
  res = await get('/account/security', cookies);
  assert.equal(res.status, 302);
  outbox.length = 0;
  res = await get('/account/reauth?next=/account/security', cookies);
  assert.equal(res.status, 200);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  assert.equal(outbox.find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject)), undefined, 'no email for a TOTP account');
  res = await post('/account/reauth', { _csrf: csrf, password: pw, code: generate(secret, Date.now() + 30_000), next: '/account/security' }, cookies);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/account/security');
  res = await get('/account/security', cookies);
  assert.equal(res.status, 200);
  let page = await res.text();
  const securityCsrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post('/account/security/recovery-codes/regenerate', {
    _csrf: securityCsrf, confirmation: 'REPLACE RECOVERY CODES',
  }, cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Recovery codes/i);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ?', [userId])).rows[0].count), 10);
  res = await post('/account/security/totp/disable', {
    _csrf: securityCsrf, confirmation: 'USE EMAIL CODES',
  }, cookies);
  assert.equal(res.status, 302);
  const switched = (await db.query(
    `SELECT twofa_method, totp_secret_ciphertext, totp_secret_nonce, totp_confirmed_at
       FROM users WHERE id = ?`,
    [userId],
  )).rows[0];
  assert.equal(switched.twofa_method, 'email');
  assert.equal(switched.totp_secret_ciphertext, null);
  assert.equal(switched.totp_secret_nonce, null);
  assert.equal(switched.totp_confirmed_at, null);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ?', [userId])).rows[0].count), 0);
});
test('password change preserves the current session and revokes other sessions', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `password-change-${suffix}@allowed-${suffix}.example`;
  const oldPassword = 'old-password-change-passphrase';
  const newPassword = 'new-password-change-passphrase';
  const userId = await insertUser({ email, password: oldPassword, status: 'approved' });
  const current = jar();
  const other = jar();
  await loginAs(current, email, oldPassword);
  await loginAs(other, email, oldPassword);
  let res = await get('/account/reauth?next=/account/security', current);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = [...outbox].reverse().find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password: oldPassword, code, next: '/account/security' }, current);
  assert.equal(res.status, 302);
  res = await get('/account/security', current);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const rawSessionIds = (await db.query('SELECT id FROM sessions WHERE user_id = ?', [userId])).rows.map((row) => row.id);
  rawSessionIds.forEach((id) => assert.doesNotMatch(page, new RegExp(id), 'database session IDs are not rendered'));
  res = await post('/account/security/password', {
    _csrf: csrf, password: newPassword, confirm_password: newPassword,
  }, current);
  assert.equal(res.status, 302);
  assert.equal((await get('/dashboard', current)).status, 200, 'current session survives');
  assert.equal((await get('/dashboard', other)).headers.get('location'), '/login', 'other session revoked');
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [userId])).rows[0].count), 1);
  const oldAttempt = jar();
  await get('/consent', oldAttempt);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, oldAttempt);
  const oldAltcha = await solveAltcha(await (await get('/login', oldAttempt)).text());
  res = await post('/login', { email, password: oldPassword, altcha: oldAltcha }, oldAttempt);
  assert.equal(res.status, 401, 'old password no longer starts a login');
  const fresh = jar();
  await loginAs(fresh, email, newPassword);
  assert.equal((await get('/dashboard', fresh)).status, 200);
});
test('avatar source selection stores only bounded safe image data URIs', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `avatar-${suffix}@allowed-${suffix}.example`;
  const password = 'avatar-source-test-passphrase';
  const userId = await insertUser({ email, password, status: 'approved' });
  const { newId } = await import('../src/util/ids.js');
  const workspaceId = newId();
  const profileId = newId();
  const username = `avatar${suffix}`.slice(0, 30).toLowerCase();
  const now = Date.now();
  await db.batch([
    { sql: "INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, 'Avatar Workspace', ?, 'personal', ?, ?, ?)", params: [workspaceId, `avatar-${suffix}`, userId, now, now] },
    { sql: "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", params: [newId(), workspaceId, userId, now] },
    { sql: 'INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', params: [profileId, workspaceId, username, username, 'Avatar Profile', now, now] },
  ]);
  const cookies = jar();
  await loginAs(cookies, email, password);
  let res = await get('/settings', cookies);
  let page = await res.text();
  assert.match(page, /avatar-upload\.js/);
  assert.match(page, /Strip disallowed SVG content/);
  assert.match(page, /data-max-bytes="65536"/);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  res = await post('/account/avatar', { _csrf: csrf, avatar_source: 'data', avatar_data_uri: png }, cookies);
  assert.equal(res.status, 302);
  let stored = (await db.query('SELECT avatar_source, avatar_data_uri FROM users WHERE id = ?', [userId])).rows[0];
  assert.equal(stored.avatar_source, 'data');
  assert.equal(stored.avatar_data_uri, png);
  res = await get(`/u/${username}`, cookies);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /data:image\/png;base64,/);
  const unsafeSvg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>').toString('base64')}`;
  res = await post('/account/avatar', { _csrf: csrf, avatar_source: 'data', avatar_data_uri: unsafeSvg }, cookies);
  assert.equal(res.status, 400);
  const safeSvg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#456"/></svg>').toString('base64')}`;
  res = await post('/account/avatar', { _csrf: csrf, avatar_source: 'data', avatar_data_uri: safeSvg }, cookies);
  assert.equal(res.status, 302);
  stored = (await db.query('SELECT avatar_source, avatar_data_uri FROM users WHERE id = ?', [userId])).rows[0];
  assert.equal(stored.avatar_data_uri, safeSvg);
  res = await post('/account/avatar', { _csrf: csrf, avatar_source: 'identicon', avatar_data_uri: png }, cookies);
  assert.equal(res.status, 302);
  stored = (await db.query('SELECT avatar_source, avatar_data_uri FROM users WHERE id = ?', [userId])).rows[0];
  assert.equal(stored.avatar_source, 'identicon');
  assert.equal(stored.avatar_data_uri, null, 'unused uploaded data is discarded');
});
test('email change requires new-address confirmation and revokes every session', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const oldEmail = `email-old-${suffix}@allowed-${suffix}.example`;
  const newEmail = `email-new-${suffix}@allowed-new-${suffix}.example`;
  const password = 'email-change-test-passphrase';
  const userId = await insertUser({ email: oldEmail, password, status: 'approved' });
  const cookies = jar();
  await loginAs(cookies, oldEmail, password);
  let res = await get('/account/reauth?next=/account/security', cookies);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = [...outbox].reverse().find((m) => m.to === oldEmail && /confirm a sensitive change/i.test(m.subject));
  res = await post('/account/reauth', {
    _csrf: csrf, password, code: /code is:\s*(\d{6})/.exec(reauthMail.text)[1], next: '/account/security',
  }, cookies);
  assert.equal(res.status, 302);
  res = await get('/account/security', cookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  outbox.length = 0;
  res = await post('/account/security/email', { _csrf: csrf, email: newEmail }, cookies);
  assert.equal(res.status, 302);
  assert.equal((await db.query('SELECT email FROM users WHERE id = ?', [userId])).rows[0].email, oldEmail, 'address does not change before confirmation');
  const confirmation = outbox.find((m) => m.to === newEmail && /confirm your new email/i.test(m.subject));
  assert.ok(confirmation);
  const link = /https:\/\/test\.example\.com([^\s]+)/.exec(confirmation.text)[1];
  res = await get(link, cookies);
  assert.equal(res.status, 200);
  assert.equal((await db.query('SELECT email FROM users WHERE id = ?', [userId])).rows[0].email, newEmail);
  assert.equal((await get('/dashboard', cookies)).headers.get('location'), '/login', 'email completion revokes current session too');
  assert.ok(outbox.find((m) => m.to === oldEmail && /security notice/i.test(m.subject)));
  assert.ok(outbox.find((m) => m.to === newEmail && /security notice/i.test(m.subject)));
  const oldLogin = jar();
  await get('/consent', oldLogin);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, oldLogin);
  const oldAltcha = await solveAltcha(await (await get('/login', oldLogin)).text());
  assert.equal((await post('/login', { email: oldEmail, password, altcha: oldAltcha }, oldLogin)).status, 401);
  const newLogin = jar();
  await loginAs(newLogin, newEmail, password);
  assert.equal((await get('/dashboard', newLogin)).status, 200);
});
test('Administrator recovery resets credentials and authentication state once', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `recovery-target-${suffix}@allowed-${suffix}.example`;
  const adminEmail = `recovery-admin-${suffix}@allowed-${suffix}.example`;
  const oldPassword = 'recovery-old-password-passphrase';
  const newPassword = 'recovery-new-password-passphrase';
  const adminPassword = 'recovery-admin-passphrase';
  const userId = await insertUser({ email, password: oldPassword, status: 'approved' });
  await insertUser({ email: adminEmail, password: adminPassword, status: 'approved', role: 'administrator' });
  const targetSession = jar();
  await loginAs(targetSession, email, oldPassword);
  const { generateSecret } = await import('../src/auth/totp.js');
  await enrollTotpDirectly(userId, generateSecret());
  const { newId } = await import('../src/util/ids.js');
  const { keyedHash } = await import('../src/util/crypto.js');
  await db.query(
    'INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
    [newId(), userId, keyedHash('beef-cafe'), Date.now()],
  );
  const admin = jar();
  await loginAs(admin, adminEmail, adminPassword);
  let res = await get('/account/reauth?next=/admin/recovery', admin);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const reauthMail = [...outbox].reverse().find((m) => m.to === adminEmail && /confirm a sensitive change/i.test(m.subject));
  res = await post('/account/reauth', {
    _csrf: csrf, password: adminPassword, code: /code is:\s*(\d{6})/.exec(reauthMail.text)[1], next: '/admin/recovery',
  }, admin);
  assert.equal(res.status, 302);
  res = await get('/admin/recovery', admin);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  outbox.length = 0;
  res = await post('/admin/recovery', {
    _csrf: csrf, email, evidence_category: 'mailbox_and_offline_record', reason: 'Mailbox and offline record verified',
  }, admin);
  assert.equal(res.status, 302);
  const recovery = (await db.query('SELECT id, status FROM recovery_cases WHERE user_id = ?', [userId])).rows[0];
  assert.equal(recovery.status, 'pending');
  res = await post(`/admin/recovery/${recovery.id}/decision`, {
    _csrf: csrf, action: 'approved', reason: 'Two independent signals confirmed', confirmation: 'APPROVE RECOVERY',
  }, admin);
  assert.equal(res.status, 302);
  const recoveryMail = outbox.find((m) => m.to === email && /recovery approved/i.test(m.subject));
  assert.ok(recoveryMail);
  const resetPath = /https:\/\/test\.example\.com([^\s]+)/.exec(recoveryMail.text)[1];
  const resetBrowser = jar();
  await get('/consent', resetBrowser);
  await post('/consent', { policies: 'on', age18: 'on', next: resetPath }, resetBrowser);
  res = await get(resetPath, resetBrowser);
  assert.equal(res.status, 200);
  res = await post(resetPath, { password: newPassword, confirm_password: newPassword }, resetBrowser);
  assert.equal(res.status, 200);
  const recovered = (await db.query(
    'SELECT twofa_method, totp_secret_ciphertext FROM users WHERE id = ?', [userId],
  )).rows[0];
  assert.equal(recovered.twofa_method, 'email');
  assert.equal(recovered.totp_secret_ciphertext, null);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ?', [userId])).rows[0].count), 0);
  assert.equal((await db.query('SELECT status, active_user_key FROM recovery_cases WHERE id = ?', [recovery.id])).rows[0].status, 'completed');
  assert.equal((await get('/dashboard', targetSession)).headers.get('location'), '/login');
  assert.equal((await get(resetPath, resetBrowser)).status, 404, 'recovery capability is single use');
  const fresh = jar();
  await loginAs(fresh, email, newPassword);
  assert.equal((await get('/dashboard', fresh)).status, 200);
});
test('account deletion restricts immediately, cancels freshly, and purges after a hold', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `delete-${suffix}@allowed-${suffix}.example`;
  const adminEmail = `delete-owner-${suffix}@allowed-${suffix}.example`;
  const password = 'account-deletion-test-passphrase';
  const userId = await insertUser({ email, password, status: 'approved' });
  const ownerId = await insertUser({ email: adminEmail, password: password, status: 'approved', role: 'owner' });
  const { newId } = await import('../src/util/ids.js');
  const workspaceId = newId();
  const profileId = newId();
  const now = Date.now();
  await db.batch([
    { sql: "INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, 'Delete Workspace', ?, 'personal', ?, ?, ?)", params: [workspaceId, `delete-${suffix}`, userId, now, now] },
    { sql: "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", params: [newId(), workspaceId, userId, now] },
    { sql: 'INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', params: [profileId, workspaceId, `delete${suffix}`.slice(0, 30).toLowerCase(), `Delete${suffix}`.slice(0, 30), 'Delete Profile', now, now] },
  ]);
  const cookies = jar();
  await loginAs(cookies, email, password);
  let res = await get('/account/reauth?next=/account/deletion', cookies);
  let page = await res.text();
  let csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  let reauthMail = [...outbox].reverse().find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  await post('/account/reauth', { _csrf: csrf, password, code: /code is:\s*(\d{6})/.exec(reauthMail.text)[1], next: '/account/deletion' }, cookies);
  res = await get('/account/deletion', cookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  res = await post('/account/deletion', { _csrf: csrf, confirmation: 'DELETE MY ACCOUNT' }, cookies);
  assert.equal(res.status, 302);
  assert.equal(Number((await db.query('SELECT published FROM profiles WHERE id = ?', [profileId])).rows[0].published), 0);
  assert.equal((await get('/dashboard', cookies)).headers.get('location'), '/account/deletion');
  res = await post('/account/deletion/cancel', { _csrf: csrf, confirmation: 'CANCEL DELETION' }, cookies);
  assert.match(res.headers.get('location'), /^\/account\/reauth/, 'cancellation requires a new step-up');
  outbox.length = 0;
  res = await get('/account/reauth?next=/account/deletion', cookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  reauthMail = outbox.find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  await post('/account/reauth', { _csrf: csrf, password, code: /code is:\s*(\d{6})/.exec(reauthMail.text)[1], next: '/account/deletion' }, cookies);
  res = await post('/account/deletion/cancel', { _csrf: csrf, confirmation: 'CANCEL DELETION' }, cookies);
  assert.equal(res.status, 302);
  assert.equal(Number((await db.query('SELECT published FROM profiles WHERE id = ?', [profileId])).rows[0].published), 1);
  res = await get('/account/deletion', cookies);
  page = await res.text();
  csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  await post('/account/deletion', { _csrf: csrf, confirmation: 'DELETE MY ACCOUNT' }, cookies);
  const deletion = (await db.query("SELECT id FROM deletion_requests WHERE user_id = ? AND status = 'pending'", [userId])).rows[0];
  const holdId = newId();
  await db.batch([
    { sql: 'UPDATE deletion_requests SET purge_after = ? WHERE id = ?', params: [Date.now() - 1, deletion.id] },
    { sql: 'INSERT INTO legal_holds (id, user_id, scope, reason, created_by, started_at, review_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [holdId, userId, 'Account records', 'Documented preservation duty', ownerId, now, now + 7 * 24 * 60 * 60 * 1000] },
  ]);
  const { runMaintenance } = await import('../src/maintenance.js');
  await runMaintenance({ now: Date.now(), log: () => {} });
  assert.equal((await db.query('SELECT status FROM deletion_requests WHERE id = ?', [deletion.id])).rows[0].status, 'held');
  assert.equal((await db.query('SELECT email FROM users WHERE id = ?', [userId])).rows[0].email, email, 'legal hold pauses purge');
  await db.batch([
    { sql: 'UPDATE legal_holds SET released_at = ? WHERE id = ?', params: [Date.now(), holdId] },
    { sql: "UPDATE deletion_requests SET status = 'pending' WHERE id = ?", params: [deletion.id] },
  ]);
  await runMaintenance({ now: Date.now(), log: () => {} });
  const tombstone = (await db.query('SELECT email, signup_status FROM users WHERE id = ?', [userId])).rows[0];
  assert.equal(tombstone.signup_status, 'terminated');
  assert.match(tombstone.email, /@deleted\.invalid$/);
  assert.equal((await db.query('SELECT id FROM profiles WHERE id = ?', [profileId])).rows.length, 0);
  assert.equal((await db.query('SELECT status FROM deletion_requests WHERE id = ?', [deletion.id])).rows[0].status, 'completed');
  assert.equal((await db.query('SELECT id FROM sessions WHERE user_id = ?', [userId])).rows.length, 0);
  const auditRefs = await db.query("SELECT subject_user_id FROM audit_events WHERE event_type = 'account.deletion_requested' AND target = ?", [deletion.id]);
  assert.match(auditRefs.rows[0].subject_user_id, /^deleted:/);
});
test('reauth return path rejects an off-site redirect', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `redir-${suffix}@allowed-${suffix}.example`;
  const pw = 'open-redirect-passphrase';
  await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, email, pw);
  const res = await get('/account/reauth?next=https://evil.example/x', cookies);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /name="next" value="\/settings"/);
  assert.doesNotMatch(html, /evil\.example/);
});
test('account export supports direct and renewable-window emailed downloads', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `export-${suffix}@allowed-${suffix}.example`;
  const pw = 'export-user-passphrase-xx';
  const userId = await insertUser({ email, password: pw, status: 'approved', role: 'none' });
  const cookies = jar();
  await loginAs(cookies, email, pw);
  let res = await get('/account/export', cookies);
  assert.equal(res.status, 200);
  let csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  res = await post('/account/export/download', { _csrf: csrf }, cookies);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/account\/reauth/);
  outbox.length = 0;
  res = await get('/account/reauth?next=/account/export', cookies);
  csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  const reauthMail = outbox.find((m) => m.to === email && /confirm a sensitive change/i.test(m.subject));
  const code = /code is:\s*(\d{6})/.exec(reauthMail.text)[1];
  res = await post('/account/reauth', { _csrf: csrf, password: pw, code, next: '/account/export' }, cookies);
  assert.equal(res.headers.get('location'), '/account/export');
  res = await get('/account/export', cookies);
  csrf = /name="_csrf" value="([^"]+)"/.exec(await res.text())[1];
  res = await post('/account/export/download', { _csrf: csrf }, cookies);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/zip/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="NamelessPronouns-\d{4}\.\d{2}\.\d{2}-\d{10}\.zip"$/);
  const direct = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(direct.subarray(0, 4), Buffer.from('PK\x03\x04', 'binary'));
  const { collectUserData } = await import('../src/data-export.js');
  const collected = await collectUserData(userId);
  assert.equal(collected.account.email, email);
  for (const forbidden of ['password_hash', 'password_hash_version', 'totp_secret_ciphertext', 'totp_secret_nonce', 'totp_key_version', 'totp_last_step']) {
    assert.equal(Object.hasOwn(collected.account, forbidden), false, `${forbidden} is excluded`);
  }
  outbox.length = 0;
  res = await post('/account/export/link', { _csrf: csrf }, cookies);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/account/export?sent=1');
  const exportMail = outbox.find((m) => m.to === email && /account data export/i.test(m.subject));
  assert.ok(exportMail, 'export link email sent');
  const downloadPath = /\/account\/export\/download\/[A-Za-z0-9_-]+/.exec(exportMail.text)[0];
  const rawToken = downloadPath.split('/').at(-1);
  const tokenRow = await db.query('SELECT token_hash, used_at, expires_at, created_at FROM data_export_tokens WHERE user_id = ?', [userId]);
  assert.equal(tokenRow.rows.length, 1);
  assert.notEqual(tokenRow.rows[0].token_hash, rawToken);
  assert.equal(tokenRow.rows[0].used_at, null);
  assert.ok(Number(tokenRow.rows[0].expires_at) - Number(tokenRow.rows[0].created_at) >= 14 * 24 * 60 * 60 * 1000 - 1000);
  const initialDeadline = Date.now() + 60_000;
  await db.query('UPDATE data_export_tokens SET expires_at = ? WHERE token_hash = ?', [initialDeadline, tokenRow.rows[0].token_hash]);
  const capabilityBrowser = jar();
  res = await get(downloadPath, capabilityBrowser);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/consent');
  assert.doesNotMatch(res.headers.get('location'), new RegExp(rawToken), 'token is not copied into the consent URL');
  await get('/consent', capabilityBrowser);
  res = await post('/consent', { policies: 'on', age18: 'on', next: '/' }, capabilityBrowser);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), downloadPath, 'consent returns directly to the encrypted same-origin path');
  res = await get(res.headers.get('location'), capabilityBrowser);
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 4), Buffer.from('PK\x03\x04', 'binary'));
  const activated = await db.query('SELECT used_at, expires_at FROM data_export_tokens WHERE token_hash = ?', [(await import('../src/util/crypto.js')).keyedHash(rawToken)]);
  assert.ok(activated.rows[0].used_at);
  assert.ok(Number(activated.rows[0].expires_at) - Number(activated.rows[0].used_at) >= 7 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(Number(activated.rows[0].expires_at) > initialDeadline);
  res = await get(downloadPath, capabilityBrowser);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  await db.query('UPDATE data_export_tokens SET expires_at = ? WHERE token_hash = ?', [Date.now() - 1, (await import('../src/util/crypto.js')).keyedHash(rawToken)]);
  res = await get(downloadPath, capabilityBrowser);
  assert.equal(res.status, 404);
  outbox.length = 0;
  res = await post('/account/export/link', { _csrf: csrf }, cookies);
  assert.equal(res.status, 302);
  const blockedMail = outbox.find((m) => m.to === email && /account data export/i.test(m.subject));
  const blockedPath = /\/account\/export\/download\/[A-Za-z0-9_-]+/.exec(blockedMail.text)[0];
  const { createBan } = await import('../src/bans.js');
  await createBan({ type: 'user', value: userId, scope: 'account', reason: 'test' });
  res = await get(blockedPath, capabilityBrowser);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /ban/i);
  const unused = await db.query('SELECT used_at FROM data_export_tokens WHERE token_hash = ?', [(await import('../src/util/crypto.js')).keyedHash(blockedPath.split('/').at(-1))]);
  assert.equal(unused.rows[0].used_at, null);
});
async function insertPublishedProfile({ key, display, userId }) {
  const { newId } = await import('../src/util/ids.js');
  const wsId = newId();
  const pid = newId();
  const mid = newId();
  const now = Date.now();
  await db.batch([
    { sql: `INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, 'personal', ?, ?, ?)`, params: [wsId, `${display} Workspace`, `personal-${key}`, userId, now, now] },
    { sql: `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`, params: [mid, wsId, userId, now] },
    { sql: `INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, params: [pid, wsId, key, display, display, now, now] },
  ]);
}
test('usernames are case-insensitive but the URL canonicalizes to the stored casing', { skip }, async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `case-${suffix}@allowed-${suffix}.example`;
  const userId = await insertUser({ email, password: 'case-user-passphrase-xx', status: 'approved', role: 'none' });
  const display = `CaseUser${suffix}`.slice(0, 32);
  const key = display.toLowerCase();
  await insertPublishedProfile({ key, display, userId });
  const viewer = jar();
  await get('/consent', viewer);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, viewer);
  let res = await get(`/u/${display}`, viewer);
  assert.equal(res.status, 200);
  assert.match(await res.text(), new RegExp(`@${display}`));
  res = await get(`/u/${key}`, viewer);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/u/${display}`);
  res = await get(`/u/${display.toUpperCase()}`, viewer);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/u/${display}`);
  res = await get(`/@${key}`, viewer);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/u/${key}`);
  res = await get(res.headers.get('location'), viewer);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/u/${display}`);
  res = await get(`/user/${display}`, viewer);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/u/${display}`);
});
test('signup stores the username casing while enforcing case-insensitive uniqueness', { skip }, async () => {
  const cookies = jar();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `mc-${suffix}@allowed-${suffix}.example`;
  const password = 'mixed-case-passphrase-x';
  const display = `MixedCase${suffix}`.slice(0, 32);
  await get('/consent', cookies);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  let a = await solveAltcha(await (await get('/signup', cookies)).text());
  let res = await post('/signup', { email, password, profile_username: display, display_name: 'Mixed Case', reason: 'I want a personal profile.', policies: 'on', age18: 'on', altcha: a }, cookies);
  assert.equal(res.status, 200);
  const claim = await db.query('SELECT username, username_display FROM public_username_claims WHERE username = ?', [display.toLowerCase()]);
  assert.equal(claim.rows.length, 1);
  assert.equal(claim.rows[0].username_display, display);
  const other = jar();
  await get('/consent', other);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, other);
  a = await solveAltcha(await (await get('/signup', other)).text());
  res = await post('/signup', { email: `mc2-${suffix}@allowed-${suffix}.example`, password, profile_username: display.toUpperCase(), display_name: 'Mixed Case', reason: 'I want a personal profile.', policies: 'on', age18: 'on', altcha: a }, other);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /unavailable/i);
});
test('magic link is inert without the matching pending cookie', { skip }, async () => {
  const cookies = jar();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `magic-${suffix}@allowed-${suffix}.example`;
  const password = 'another-long-enough-passphrase';
  const uname = `magic${suffix}`.slice(0, 20);
  await get('/consent', cookies);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, cookies);
  let res = await get('/signup', cookies);
  const a1 = await solveAltcha(await res.text());
  await post('/signup', { email, password, profile_username: uname, display_name: 'Magic Tester', reason: 'I want a personal profile.', policies: 'on', age18: 'on', altcha: a1 }, cookies);
  await db.query('UPDATE users SET signup_status = ?, email_verified_at = ? WHERE email = ?', ['approved', Date.now(), email]);
  res = await get('/login', cookies);
  const a2 = await solveAltcha(await res.text());
  outbox.length = 0;
  await post('/login', { email, password, altcha: a2 }, cookies);
  const codeMail = outbox.find((m) => m.to === email && /sign-in code/i.test(m.subject));
  const link = /\/login\/2fa\/email-link\/[^\s]+/.exec(codeMail.text)[0];
  const other = jar();
  await get('/consent', other);
  await post('/consent', { policies: 'on', age18: 'on', next: '/' }, other);
  const inert = await get(link, other);
  assert.equal(inert.status, 200);
  assert.match(await inert.text(), /original browser/i);
  const code = /code is:\s*(\d{6})/.exec(codeMail.text)[1];
  const done = await post('/login/2fa', { code }, cookies);
  assert.equal(done.headers.get('location'), '/dashboard');
});
