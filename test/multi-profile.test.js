import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import {
  additionalProfileStatements,
  deleteProfileStatements,
  firstProfileStatements,
  profileLimitFor,
  USERNAME_HOLD_MS,
} from '../src/profiles.js';
import { avatarUrl, profileAvatarUrl } from '../src/avatar.js';
import { POLICIES } from '../src/ratelimit.js';
import config from '../src/config.js';
const viewsDir = fileURLToPath(new URL('../views/', import.meta.url));
test('an account may hold several profiles up to a limit an Administrator can override', () => {
  assert.equal(config.MAX_PROFILES_PER_USER, 5);
  assert.equal(profileLimitFor({}), 5);
  assert.equal(profileLimitFor({ profile_limit: null }), 5);
  assert.equal(profileLimitFor({ profile_limit: 12 }), 12);
  assert.equal(profileLimitFor({ profile_limit: 0 }), 5, 'a nonsense override falls back to the site default');
  assert.ok(POLICIES.profile_create, 'creating profiles is rate limited');
});
test('an extra profile belongs to the same account and claims its own username', () => {
  const { profileId, statements } = additionalProfileStatements({
    userId: 'user-1', username: 'second', usernameDisplay: 'Second',
    displayName: 'Second Profile', now: 1000,
  });
  assert.match(profileId, /.+/);
  assert.equal(statements.length, 3, 'insert the profile, clear any stale claim, then claim the username');
  assert.match(statements[0].sql, /INSERT INTO profiles/);
  assert.deepEqual(statements[0].params.slice(1, 5), ['user-1', 'second', 'Second', 'Second Profile']);
  assert.match(statements[1].sql, /DELETE FROM public_username_claims WHERE username = \?/);
  assert.match(statements[2].sql, /INSERT INTO public_username_claims/);
  assert.match(statements[2].sql, /'active'/);
  assert.equal(statements[2].params[2], profileId);
  const first = firstProfileStatements({
    userId: 'user-1', username: 'first', displayName: 'First', now: 1000,
  });
  assert.equal(first.statements.length, 2, 'the first profile only inserts itself and activates its claim');
  assert.equal(first.statements[0].params[1], 'user-1');
});
test('deleting a profile holds its username for seven days before anyone else may take it', () => {
  assert.equal(USERNAME_HOLD_MS, 7 * 24 * 60 * 60 * 1000);
  const statements = deleteProfileStatements({
    profileId: 'profile-1', username: 'gone', usernameDisplay: 'Gone', userId: 'user-1', now: 5000,
  });
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /DELETE FROM profiles WHERE id = \?/);
  assert.match(statements[2].sql, /'reserved'/);
  assert.deepEqual(statements[2].params, ['gone', 'Gone', 'user-1', 5000 + USERNAME_HOLD_MS, 5000]);
});
test('the migration adds the profile limit, per-profile icons, and the reserved claim state', async () => {
  const sql = await readFile(new URL('../db/migrations/0007_profiles_per_account.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE users ADD COLUMN profile_limit INTEGER/);
  assert.match(sql, /ALTER TABLE profiles ADD COLUMN avatar_source TEXT/);
  assert.match(sql, /ALTER TABLE profiles ADD COLUMN avatar_data_uri TEXT/);
  assert.match(sql, /CHECK \(state IN \('pending', 'active', 'reserved'\)\)/);
  assert.match(sql, /reserved_until BIGINT/);
  assert.match(sql, /INSERT INTO public_username_claims_new/, 'existing claims survive the rebuild');
  assert.match(sql, /ALTER TABLE public_username_claims_new RENAME TO public_username_claims/);
});
test('a profile icon falls back to the account icon until the profile sets its own', () => {
  const owner = { id: 'user-1', email: 'person@example.com', avatar_source: 'identicon', avatar_data_uri: null };
  const accountIcon = avatarUrl(owner);
  assert.equal(profileAvatarUrl({ id: 'profile-1' }, owner), accountIcon);
  assert.equal(profileAvatarUrl({ id: 'profile-1', avatar_source: 'inherit' }, owner), accountIcon);
  const ownIcon = profileAvatarUrl({ id: 'profile-1', avatar_source: 'identicon' }, owner);
  assert.notEqual(ownIcon, accountIcon, 'a profile identicon is seeded by the profile, not the account');
  assert.match(profileAvatarUrl({ id: 'profile-1', avatar_source: 'gravatar' }, owner), /gravatar\.com/);
});
test('the dashboard offers another profile, a delete confirmation, and the hold notice', async () => {
  const render = (profiles, profileLimit) => ejs.renderFile(`${viewsDir}dashboard.ejs`, {
    title: 'Dashboard', profiles, profileLimit, usernameHoldDays: 7,
    user: { email: 'person@example.com' }, csrfToken: 'csrf',
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  const two = await render([
    { id: 'p1', username: 'first', display_name: 'First', published: 1, role: 'owner' },
    { id: 'p2', username: 'second', display_name: 'Second', published: 0, role: 'owner' },
  ], 5);
  assert.match(two, /Using 2 of 5 profiles\./);
  assert.match(two, /href="\/profiles\/new"/);
  assert.match(two, /action="\/profiles\/p2\/delete"/);
  assert.ok(two.includes('Type DELETE PROFILE'), 'deleting a profile demands the exact phrase');
  assert.ok(two.includes('placeholder="DELETE PROFILE"'));
  assert.match(two, /reserved for this account for 7 days/);
  const one = await render([
    { id: 'p1', username: 'only', display_name: 'Only', published: 1, role: 'owner' },
  ], 5);
  assert.doesNotMatch(one, /action="\/profiles\/p1\/delete"/, 'the last profile has no delete form');
  const full = await render([
    { id: 'p1', username: 'a', display_name: 'A', published: 1, role: 'owner' },
    { id: 'p2', username: 'b', display_name: 'B', published: 1, role: 'owner' },
  ], 2);
  assert.doesNotMatch(full, /href="\/profiles\/new"/, 'no invitation to pass the limit');
});
test('the new-profile page states the limit and stops at it', async () => {
  const render = (locals) => ejs.renderFile(`${viewsDir}profile-new.ejs`, {
    title: 'New profile', error: null, values: { username: '', displayName: '' },
    limit: 5, owned: 1, atLimit: false, user: null, csrfToken: 'csrf', ...locals,
  }, { async: true });
  const open = await render({});
  assert.match(open, /This account uses 1 of its 5 profiles\./);
  assert.match(open, /action="\/profiles\/new"/);
  assert.match(open, /name="username"[^>]*pattern="\[A-Za-z0-9\]\+\(-\[A-Za-z0-9\]\+\)\*"/);
  assert.match(open, /name="display_name"/);
  const capped = await render({ owned: 5, atLimit: true });
  assert.doesNotMatch(capped, /name="username"/, 'no form once the account is at its limit');
  assert.match(capped, /ask an Administrator to raise the limit/);
});
test('the profile editor edits that profile icon and account settings keeps the default', async () => {
  const editor = await readFile(`${viewsDir}profile-edit.ejs`, 'utf8');
  assert.match(editor, /href="#profile-icon"/, 'the editor links to its own icon section');
  assert.match(editor, /action="\/profiles\/<%= profile\.id %>\/avatar"/);
  assert.match(editor, /value="inherit"/, 'a profile may follow the account default');
  assert.match(editor, /avatar-upload\.js/);
  const settings = await readFile(`${viewsDir}account/settings.ejs`, 'utf8');
  assert.match(settings, /<h2>Default profile icon<\/h2>/);
  assert.match(settings, /action="\/account\/avatar"/);
  assert.match(settings, /unless that profile sets its own/);
});
