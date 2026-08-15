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
  MAX_USERNAME_HOLDS,
  USERNAME_HOLD_MS,
} from '../src/profiles.js';
import { avatarUrl, profileAvatarUrl } from '../src/avatar.js';
import { badgeView } from '../src/routes/public-profile.js';
import { POLICIES } from '../src/ratelimit.js';
import config from '../src/config.js';
import fsSync from 'node:fs';
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
test('the dashboard lists profiles and offers another, but never deletes one', async () => {
  const render = (profiles, profileLimit) => ejs.renderFile(`${viewsDir}dashboard.ejs`, {
    title: 'Dashboard', profiles, profileLimit,
    user: { email: 'person@example.com' }, csrfToken: 'csrf',
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  const two = await render([
    { id: 'p1', username: 'first', display_name: 'First', published: 1 },
    { id: 'p2', username: 'second', display_name: 'Second', published: 0 },
  ], 5);
  assert.match(two, /Using 2 of 5 profiles\./);
  assert.match(two, /href="\/profiles\/new"/);
  assert.doesNotMatch(two, /\/delete/, 'deleting happens in the editor, not here');

  assert.ok(two.indexOf('/profiles/p1/edit') < two.indexOf('/profiles/p2/edit'), 'listed in the given order');
  const full = await render([
    { id: 'p1', username: 'a', display_name: 'A', published: 1 },
    { id: 'p2', username: 'b', display_name: 'B', published: 1 },
  ], 2);
  assert.doesNotMatch(full, /href="\/profiles\/new"/, 'no invitation to pass the limit');
});
test('the profile editor holds the delete form, and only when another profile remains', async () => {
  const editor = await readFile(`${viewsDir}profile-edit.ejs`, 'utf8');
  assert.match(editor, /<% if \(canDelete\) \{ %>/, 'the last profile of an account cannot be deleted here');
  assert.match(editor, /action="\/profiles\/<%= profile\.id %>\/delete"/);
  assert.ok(editor.includes('Type <%= profile.username %> exactly, capital letters included'),
    'deleting a profile demands its own username, capitalisation included');
  assert.match(editor, /autocapitalize="off"/, 'phones must not helpfully capitalise it');
  assert.ok(editor.includes('placeholder="<%= profile.username %>"'));
  assert.match(editor, /class="danger">Delete profile<\/button>/, 'a destructive action looks destructive');
  assert.match(editor, /reserved to this account for <%= usernameHoldDays %> days/);
});
test('the new-profile page states the limit and stops at it', async () => {
  const render = (locals) => ejs.renderFile(`${viewsDir}profile-new.ejs`, {
    title: 'New profile', error: null, values: { username: '', displayName: '' },
    limit: 5, owned: 1, atLimit: false, held: [], user: null, csrfToken: 'csrf', ...locals,
  }, { async: true });
  const open = await render({});
  assert.match(open, /This account uses 1 of its 5 profiles\./);
  assert.match(open, /action="\/profiles\/new"/);
  assert.match(open, /name="username"[^>]*pattern="\[A-Za-z0-9\]\+\(-\[A-Za-z0-9\]\+\)\*"/);
  assert.match(open, /name="display_name"/);
  const capped = await render({ owned: 5, atLimit: true });
  assert.doesNotMatch(capped, /name="username"/, 'no form once the account is at its limit');
  assert.match(capped, /ask an Administrator to raise the limit/);
  const reclaimable = await render({ held: [{ username: 'Old-Name', daysLeft: 3 }] });
  assert.match(reclaimable, /Old-Name/);
  assert.match(reclaimable, /3 days left/);
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

test('a hidden staff badge is withheld from the page, and marked for other staff', () => {
  const staffProfile = { staff_role: 'moderator', staff_badge_hidden: 1 };
  const shown = { staff_role: 'moderator', staff_badge_hidden: 0 };
  for (const viewer of [null, undefined, { staff_role: 'none' }]) {
    const view = badgeView(staffProfile, viewer);
    assert.equal(view.staffBadge, null, 'the badge never reaches a non-staff viewer');
    assert.equal(view.staffBadgeLine, null);
    assert.equal(view.ownerEgg, false);
    assert.equal(view.staffBadgeHidden, false, 'the marker itself leaks nothing');
  }
  const staffViewer = badgeView(staffProfile, { staff_role: 'support' });
  assert.equal(staffViewer.staffBadge, 'Moderator');
  assert.equal(staffViewer.staffBadgeHidden, true, 'other staff see it flagged as hidden');
  const plain = badgeView(shown, { staff_role: 'none' });
  assert.equal(plain.staffBadge, 'Moderator');
  assert.equal(plain.staffBadgeHidden, false);
  const owner = badgeView({ staff_role: 'owner', staff_badge_hidden: 1 }, { staff_role: 'none' });
  assert.equal(owner.ownerEgg, false, 'hiding the badge hides the owner easter egg too');
  assert.deepEqual(badgeView({ staff_role: 'none', staff_badge_hidden: 0 }, null),
    { staffBadge: null, staffBadgeLine: null, staffBadgeHidden: false, ownerEgg: false });
});
test('the public page prints the hidden marker only when it is set', async () => {
  const view = await readFile(`${viewsDir}profile.ejs`, 'utf8');
  assert.match(view, /locals\.staffBadgeHidden/, 'the marker is conditional');
  assert.ok(view.includes('[Status: Hidden]'));
});
test('staff choose badge visibility per profile', async () => {
  const editor = await readFile(`${viewsDir}profile-edit.ejs`, 'utf8');
  assert.match(editor, /<% if \(isStaff\) \{ %>/, 'non-staff never see the control');
  assert.match(editor, /action="\/profiles\/<%= profile\.id %>\/staff-badge"/);
  assert.match(editor, /name="staff_badge_hidden"/);
  assert.match(editor, /Each profile is set separately\./);
});
test('the first profile is primary for good, and never deletable', () => {
  const first = firstProfileStatements({ userId: 'u1', username: 'first', displayName: 'First', now: 1 });
  assert.match(first.statements[0].sql, /is_primary/);
  assert.ok(first.statements[0].sql.includes('0, 1,'), 'the first profile is created primary');
  const extra = additionalProfileStatements({ userId: 'u1', username: 'second', displayName: 'Second', now: 1 });
  assert.ok(extra.statements[0].sql.includes('0, 0,'), 'later profiles are not');
  const editor = fsSync.readFileSync(`${viewsDir}profile-edit.ejs`, 'utf8');
  assert.match(editor, /keeps that role for good and cannot be deleted/);
});
test('username holds are capped and reclaimable by their own account', async () => {
  assert.equal(MAX_USERNAME_HOLDS, 5);
  assert.ok(POLICIES.profile_delete, 'deleting profiles is rate limited');
  assert.equal(POLICIES.profile_delete.max, 3);
  assert.equal(POLICIES.profile_delete.window, 24 * 60 * 60 * 1000);
  const newProfile = await readFile(`${viewsDir}profile-new.ejs`, 'utf8');
  assert.match(newProfile, /Usernames you can reclaim/);
  assert.match(newProfile, /day<%= hold\.daysLeft === 1 \? '' : 's' %> left/);
});
