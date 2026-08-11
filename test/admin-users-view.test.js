import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { requestedBans } from '../src/routes/admin.js';
import { ValidationError } from '../src/validation.js';
import { EASTER_EGGS } from '../src/easter-eggs.js';

test('denying a request never bans on its own', () => {
  assert.deepEqual(requestedBans({}), { targets: [], scope: 'account', expiresAt: null });
  assert.deepEqual(requestedBans({ decision_note: 'Not a real person.' }).targets, []);
  assert.deepEqual(
    requestedBans({ ban_scope: 'both', ban_duration_days: '30' }),
    { targets: [], scope: 'account', expiresAt: null },
  );
  assert.deepEqual(requestedBans({ ban_target: ['everything', ''] }).targets, []);
});
test('banning while denying takes a deliberate target and a typed confirmation', () => {
  assert.throws(() => requestedBans({ ban_target: 'email' }), ValidationError);
  assert.throws(() => requestedBans({ ban_target: 'email', ban_confirmation: 'ban applicant' }), ValidationError);
  const asked = requestedBans({
    ban_target: ['email', 'domain', 'email'],
    ban_confirmation: 'BAN APPLICANT',
    ban_scope: 'both',
  });
  assert.deepEqual(asked.targets, ['email', 'domain']);
  assert.equal(asked.scope, 'both');
  assert.equal(asked.expiresAt, null);
  assert.throws(
    () => requestedBans({ ban_target: 'email', ban_confirmation: 'BAN APPLICANT', ban_duration_days: '0' }),
    /1 to 3650 days/,
  );
});

test('admin user directory lists ranks and account information without plaintext email', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/users.ejs', import.meta.url)), {
    title: 'User directory',
    users: [{
      id: 'user-1', email: 'private@example.com', signup_status: 'approved', staff_role: 'administrator',
      twofa_method: 'totp', email_verified_at: 1, created_at: 1, updated_at: 2,
      profile_username: 'Example', profile_display_name: 'Example User', profile_count: 2, active_sessions: 1,
    }],
    page: 1, totalPages: 2, total: 101, user: null,
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  assert.match(html, /User directory/);
  assert.match(html, /administrator/);
  assert.match(html, /approved/);
  assert.match(html, /Example User/);
  assert.match(html, /@Example/);
  assert.match(html, /totp 2FA/);
  assert.match(html, /1 active session/);
  assert.match(html, /\/admin\/accounts\/user-1/);
  assert.match(html, /\/admin\/users\?page=2/);
  assert.doesNotMatch(html, /private@example\.com/);
  assert.doesNotMatch(html, /queued for deletion/, 'an ordinary account is not marked for deletion');
});
test('admin user directory marks accounts queued for deletion', async () => {
  const render = (overrides) => ejs.renderFile(fileURLToPath(new URL('../views/admin/users.ejs', import.meta.url)), {
    title: 'User directory',
    users: [{
      id: 'user-1', email: 'private@example.com', signup_status: 'approved', staff_role: 'none',
      twofa_method: 'email', email_verified_at: 1, created_at: 1, updated_at: 2,
      profile_username: 'Example', profile_display_name: 'Example User', profile_count: 1, active_sessions: 0,
      ...overrides,
    }],
    page: 1, totalPages: 1, total: 1, user: null,
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  const queued = await render({ deletion_status: 'pending', deletion_purge_after: 1702592000000 });
  assert.match(queued, /queued for deletion/);
  assert.match(queued, /Purge 2023-12-14T22:13:20\.000Z/);
  const held = await render({ deletion_status: 'held', deletion_purge_after: 1702592000000 });
  assert.match(held, /deletion held/);
  assert.doesNotMatch(held, /queued for deletion/);
});

function accountDetail(overrides = {}) {
  return {
    title: 'Account administration',
    account: {
      id: 'user-1', email: 'private@example.com', signup_status: 'pending', staff_role: 'none',
      twofa_method: 'email', email_verified_at: 1, requested_profile_username_display: 'Example',
      requested_display_name: 'Example User', requested_at: 1, decided_at: null, decision_note: null,
      decision_reason_public: null, request_note: 'I want a profile for my pronouns.',
      created_at: 1, updated_at: 2,
    },
    profiles: [], activeSessions: 0, roles: ['none', 'support', 'moderator', 'administrator', 'owner'],
    signupStatuses: ['pending', 'approved', 'denied', 'terminated'],
    banScopes: ['account', 'viewing', 'both'],
    activeBans: [],
    canManageRole: false, canEmergency: true, canAction: true,
    canDecideSignup: true, hasSignupIp: true,
    pendingDeletion: null, deletionGraceDays: 30,
    csrfToken: 'csrf', user: null,
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
    ...overrides,
  };
}
test('admin account page can edit the account state and action the account', async () => {
  const html = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail({
      activeBans: [{ id: 'ban-1', scope: 'both', reason: 'Abuse', created_at: 1, expires_at: null }],
    }),
    { async: true },
  );
  assert.match(html, /action="\/admin\/accounts\/user-1\/state"/);
  assert.match(html, /name="signup_status"/);
  for (const state of ['pending', 'approved', 'denied', 'terminated']) {
    assert.match(html, new RegExp(`<option value="${state}"`));
  }
  assert.match(html, /Type CHANGE ACCOUNT STATE/);
  assert.match(html, /action="\/admin\/accounts\/user-1\/ban"/);
  assert.match(html, /Type BAN ACCOUNT/);
  assert.match(html, /action="\/admin\/bans\/ban-1\/lift"/);
  assert.match(html, /action="\/admin\/accounts\/user-1\/revoke-sessions"/);
  assert.match(html, /\/admin\/audit\?subject=user-1/);
  assert.doesNotMatch(html, /private@example\.com/);
});
test('admin account page decides pending signups inline with both reasons and ban targets', async () => {
  const html = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail(),
    { async: true },
  );
  assert.match(html, /I want a profile for my pronouns\./);
  assert.match(html, /action="\/admin\/accounts\/user-1\/approve"/);
  assert.match(html, /action="\/admin\/accounts\/user-1\/deny"/);
  assert.match(html, /name="return_to" value="account"/);
  assert.match(html, /name="reason_public"/);
  assert.match(html, /name="decision_note"/);
  for (const target of ['email', 'domain', 'user', 'ip_prefix']) {
    assert.match(html, new RegExp(`name="ban_target" value="${target}"`));
  }
  assert.match(html, /name="ban_scope"/);
  assert.match(html, /name="ban_duration_days"/);
  assert.match(html, /name="ban_confirmation"/);
  assert.match(html, /<details class="deny-ban">\s*<summary>Separately, ban this applicant<\/summary>/);
  assert.doesNotMatch(html, /name="ban_target"[^>]*checked/);
});
test('admin account page marks an unrecorded signup IP as unbannable', async () => {
  const html = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail({ hasSignupIp: false }),
    { async: true },
  );
  assert.match(html, /value="ip_prefix" disabled/);
  assert.match(html, /not recorded for this request/);
});
test('admin account page offers deletion and switches to cancelling once scheduled', async () => {
  const before = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail(),
    { async: true },
  );
  assert.match(before, /action="\/admin\/accounts\/user-1\/delete"/);
  assert.match(before, /Type DELETE ACCOUNT/);
  assert.match(before, /erases the account after\s*30 days/);
  assert.doesNotMatch(before, /delete\/cancel/);
  assert.match(before, /<details class="delete-now">/);
  assert.match(before, /action="\/admin\/accounts\/user-1\/delete\/now"/);
  assert.match(before, /Type DELETE IMMEDIATELY/);
  assert.match(before, /cannot be undone/);

  const scheduled = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail({
      pendingDeletion: { id: 'del-1', status: 'pending', requested_at: 1700000000000, purge_after: 1702592000000 },
    }),
    { async: true },
  );
  assert.match(scheduled, /action="\/admin\/accounts\/user-1\/delete\/cancel"/);
  assert.match(scheduled, /Type CANCEL DELETION/);
  assert.match(scheduled, /2023-12-14T22:13:20\.000Z/);
  assert.doesNotMatch(scheduled, /Type DELETE ACCOUNT/);

  const held = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail({
      pendingDeletion: { id: 'del-1', status: 'held', requested_at: 1700000000000, purge_after: 1702592000000 },
    }),
    { async: true },
  );
  assert.match(held, /held by a legal hold/);
  assert.match(held, /will not be purged until the legal hold is released/);
});
test('admin account page hides decision, state and ban controls without permission', async () => {
  const html = await ejs.renderFile(
    fileURLToPath(new URL('../views/admin/account-detail.ejs', import.meta.url)),
    accountDetail({ canAction: false, canEmergency: false, canDecideSignup: false }),
    { async: true },
  );
  assert.doesNotMatch(html, /\/state"/);
  assert.doesNotMatch(html, /\/ban"/);
  assert.doesNotMatch(html, /revoke-sessions/);
  assert.doesNotMatch(html, /\/approve"/);
  assert.doesNotMatch(html, /\/deny"/);
  assert.doesNotMatch(html, /\/delete"/);
  assert.doesNotMatch(html, /delete\/cancel/);
  assert.doesNotMatch(html, /delete\/now/);
});
test('signup queue shows each applicant reason and the requisite decision facts', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/signups.ejs', import.meta.url)), {
    title: 'Signup requests',
    pending: [{
      id: 'user-1', email: 'private@example.com', email_verified_at: 1700000000000,
      requested_profile_username: 'example', requested_profile_username_display: 'Example',
      requested_display_name: 'Example User', request_note: 'Please let me document my pronouns.',
      requested_at: 1700000000000, created_at: 1699999999000, twofa_method: 'email',
      terms_version: '2026-01-01', privacy_version: '2026-01-01', age_18_attested_at: 1700000000000,
      claim_state: 'pending', hasSignupIp: true,
    }],
    decided: [{
      id: 'user-2', email: 'other@example.com', signup_status: 'denied',
      requested_profile_username_display: 'Other', requested_display_name: 'Other User',
      decided_at: 1700000100000, decision_note: 'Duplicate request.', decided_by_email: 'admin@example.com',
    }],
    page: 1, totalPages: 1, total: 1, selfId: 'staff-1',
    csrfToken: 'csrf', user: null,
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  assert.match(html, /Please let me document my pronouns\./);
  assert.match(html, /Their reason for requesting an account/);
  assert.match(html, /Age 18 attested/);
  assert.match(html, /Terms accepted/);
  assert.match(html, /Username claim/);
  assert.match(html, /name="return_to" value="\/admin\/signups"/);
  assert.match(html, /name="ban_target" value="ip_prefix"/);
  assert.match(html, /Recent decisions/);
  assert.match(html, /Duplicate request\./);
  assert.doesNotMatch(html, /private@example\.com/);
  assert.doesNotMatch(html, /admin@example\.com/);
});
test('signup queue refuses self-decision and flags unverified applicants', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/signups.ejs', import.meta.url)), {
    title: 'Signup requests',
    pending: [{
      id: 'staff-1', email: 'self@example.com', email_verified_at: null,
      requested_profile_username: 'self', requested_profile_username_display: 'Self',
      requested_display_name: 'Self', request_note: null, requested_at: 1, created_at: 1,
      twofa_method: 'email', terms_version: null, privacy_version: null, age_18_attested_at: null,
      claim_state: 'pending', hasSignupIp: false,
    }],
    decided: [], page: 1, totalPages: 1, total: 1, selfId: 'staff-1',
    csrfToken: 'csrf', user: null,
    obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(html, /Staff cannot decide their own request\./);
  assert.doesNotMatch(html, /\/approve"/);
  assert.match(html, /No reason was recorded with this request\./);
});
test('admin tools use a responsive action grid', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: true, canApprove: true,
    pending: [], searched: null, email: '', csrfToken: 'csrf', user: null,
    obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(html, /class="admin-tools-grid"/);
  assert.match(html, /href="\/admin\/users"/);
  assert.match(html, /href="\/admin\/reports"/);
  assert.match(html, /href="\/admin\/easter-eggs">Easter egg catalog/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.admin-tools-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit/s);
});
test('every staff role can open the complete Easter egg catalog', async () => {
  const overview = await ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: false, canApprove: false,
    pending: [], searched: null, email: '', lookupMessage: '', csrfToken: 'csrf',
    user: { staff_role: 'support' }, obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(overview, /href="\/admin\/easter-eggs">Easter egg catalog/);
  assert.doesNotMatch(overview, /href="\/admin\/users"/);

  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/easter-eggs.ejs', import.meta.url)), {
    title: 'Easter eggs', eggs: EASTER_EGGS, user: { staff_role: 'support' }, csrfToken: 'csrf',
  }, { async: true });
  assert.equal(new Set(EASTER_EGGS.map((egg) => egg.name)).size, EASTER_EGGS.length);
  assert.equal((html.match(/<tr>/g) || []).length, EASTER_EGGS.length + 1);
  for (const phrase of ['All 78 documented Easter eggs', 'Empty-state optimism', 'Staff egg catalog',
    'An easter egg collector, Apparently.', 'NamelessNanashi.fix()', 'X-Curl: excellent-choice']) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const route = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(route, /router\.get\('\/admin\/easter-eggs', requireStaff\('support'\)/);
});
test('the admin lookup has an answer for sudo', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: false, canApprove: false,
    pending: [], searched: null, email: 'sudo', lookupMessage: 'Nice try. This is not a shell.',
    csrfToken: 'csrf', user: null, obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(html, /inputmode="email" value="sudo"/);
  assert.match(html, /Nice try\. This is not a shell\./);
  assert.doesNotMatch(html, /No account with that exact email/);
});
test('the admin lookup recognizes root and SQL-shaped jokes', async () => {
  const render = (email, lookupMessage) => ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: false, canApprove: false,
    pending: [], searched: null, email, lookupMessage,
    csrfToken: 'csrf', user: null, obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(await render('root', 'Wrong tree.'), /Wrong tree\./);
  assert.match(await render('select *', 'Please step away from the database.'), /Please step away from the database\./);
});
test('the Owner receives the owner-only admin greeting', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: true, canApprove: true,
    pending: [], searched: null, email: '', lookupMessage: '',
    csrfToken: 'csrf', user: { staff_role: 'owner' }, obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(html, /Welcome back\. Everything is somehow still running\./);
});
