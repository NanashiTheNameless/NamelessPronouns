import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { selectStatements, BACKENDS } from '../src/db/migrate.js';
const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const CHILD_TABLES = [
  'profile_names', 'pronoun_sets', 'profile_links', 'profile_identity_flags',
  'profile_pronoun_preferences', 'profile_word_groups', 'profile_words',
  'profile_revisions', 'content_flags', 'content_suspension_profiles',
  'deletion_profile_states', 'content_rule_exemptions',
];
async function migrationFiles() {
  return (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
}
async function applyFile(db, file) {
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
  db.exec('BEGIN');
  for (const statement of selectStatements(sql, 'd1')) db.exec(statement);
  db.exec('COMMIT');
}
async function applyThrough(db, stopBefore) {
  for (const file of await migrationFiles()) {
    if (file === stopBefore) return;
    await applyFile(db, file);
  }
}
async function applyFrom(db, startAt) {
  let started = false;
  for (const file of await migrationFiles()) {
    if (file === startAt) started = true;
    if (!started) continue;
    await applyFile(db, file);
  }
}
function seedLegacyProfile(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO users (id, email, password_hash, password_hash_version, signup_status, staff_role, twofa_method, created_at, updated_at)
      VALUES ('u1', 'person@example.com', 'hash', 1, 'approved', 'none', 'email', ${now}, ${now});
    INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at)
      VALUES ('w1', 'Person Workspace', 'personal-person', 'personal', 'u1', ${now}, ${now});
    INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
      VALUES ('m1', 'w1', 'u1', 'owner', ${now});
    INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at)
      VALUES ('p1', 'w1', 'person', 'Person', 'Person', 1, ${now}, ${now});
    INSERT INTO public_username_claims (username, username_display, state, profile_id, created_at)
      VALUES ('person', 'Person', 'active', 'p1', ${now});
    INSERT INTO profile_names (id, profile_id, value, position, opinion) VALUES ('n1', 'p1', 'Sam', 0, 'yes');
    INSERT INTO pronoun_sets (id, profile_id, subject, object, possessive_determiner, possessive_pronoun, reflexive, position, opinion)
      VALUES ('s1', 'p1', 'they', 'them', 'their', 'theirs', 'themselves', 0, 'yes');
    INSERT INTO profile_links (id, profile_id, label, url, position) VALUES ('l1', 'p1', 'Site', 'https://example.com', 0);
    INSERT INTO profile_identity_flags (id, profile_id, flag_key, position) VALUES ('f1', 'p1', 'Nonbinary', 0);
    INSERT INTO profile_pronoun_preferences (profile_id, preference_key, opinion, position) VALUES ('p1', 'any_pronouns', 'yes', 0);
    INSERT INTO profile_word_groups (id, profile_id, heading, position) VALUES ('g1', 'p1', 'Terms', 0);
    INSERT INTO profile_words (id, group_id, value, opinion, position) VALUES ('w1w', 'g1', 'enby', 'yes', 0);
    INSERT INTO profile_revisions (id, profile_id, snapshot, created_by, created_at)
      VALUES ('r1', 'p1', '{}', 'u1', ${now});
    INSERT INTO content_rules (id, current_version_id, created_at, updated_at)
      VALUES ('rule1', 'ver1', ${now}, ${now});
    INSERT INTO content_rule_versions (id, rule_id, version, rule_type, match_value, category, severity, mode, created_at)
      VALUES ('ver1', 'rule1', 1, 'exact_field', 'bad', 'test', 'warning', 'enforcing', ${now});
    INSERT INTO content_rule_exemptions (id, rule_version_id, user_id, profile_id, reason, created_by, created_at)
      VALUES ('e_profile', 'ver1', 'u1', 'p1', 'profile scoped', 'u1', ${now});
    INSERT INTO content_rule_exemptions (id, rule_version_id, user_id, profile_id, reason, created_by, created_at)
      VALUES ('e_account', 'ver1', 'u1', NULL, 'account scoped', 'u1', ${now});
    INSERT INTO content_flags (id, user_id, profile_id, rule_version_id, field_type, attempted_ciphertext, attempted_nonce, idempotency_key_hash, policy_category, severity, mode, created_at)
      VALUES ('flag_profile', 'u1', 'p1', 'ver1', 'display_name', 'c', 'n', 'k1', 'test', 'warning', 'shadow', ${now});
    INSERT INTO content_flags (id, user_id, profile_id, rule_version_id, field_type, attempted_ciphertext, attempted_nonce, idempotency_key_hash, policy_category, severity, mode, created_at)
      VALUES ('flag_account', 'u1', NULL, 'ver1', 'display_name', 'c', 'n', 'k2', 'test', 'warning', 'shadow', ${now});
    INSERT INTO content_flag_reviews (id, flag_id, requested_by, explanation, requested_at)
      VALUES ('review1', 'flag_account', 'u1', 'please look', ${now});
  `);
}
test('the D1 rebuild keeps every profile and all of its child rows', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  await applyThrough(db, '0007_profiles_per_account.sql');
  seedLegacyProfile(db);
  await applyFrom(db, '0007_profiles_per_account.sql');
  const profiles = db.prepare('SELECT id, owner_user_id, username FROM profiles').all();
  assert.equal(profiles.length, 1, 'the profile survives the rebuild');
  assert.equal(profiles[0].owner_user_id, 'u1', 'ownership moved to the account');
  for (const table of CHILD_TABLES) {
    const seeded = ['profile_names', 'pronoun_sets', 'profile_links', 'profile_identity_flags',
      'profile_pronoun_preferences', 'profile_word_groups', 'profile_words', 'profile_revisions'].includes(table);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    if (seeded) assert.equal(count, 1, `${table} keeps its rows`);
  }
  const columns = db.prepare('PRAGMA table_info(profiles)').all().map((row) => row.name);
  assert.ok(columns.includes('owner_user_id'));
  assert.ok(!columns.includes('workspace_id'), 'workspace_id is gone');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(!tables.includes('workspaces'), 'the workspaces table is gone');
  assert.ok(!tables.includes('workspace_members'), 'the membership table is gone');
  assert.equal(tables.filter((name) => name.startsWith('mig7_')).length, 0, 'no scratch tables are left behind');
  const exemptions = db.prepare('SELECT id FROM content_rule_exemptions ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(exemptions, ['e_account', 'e_profile'], 'account-scoped rows are neither lost nor duplicated');
  const flags = db.prepare('SELECT id FROM content_flags ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(flags, ['flag_account', 'flag_profile'], 'flags with a null profile survive exactly once');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM content_flag_reviews').get().c, 1,
    'rows hanging off a surviving flag are untouched');
  const claim = db.prepare('SELECT state, profile_id FROM public_username_claims WHERE username = ?').get('person');
  assert.equal(claim.state, 'active');
  assert.equal(claim.profile_id, 'p1');
  db.exec("INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, created_at, updated_at) VALUES ('p2', 'u1', 'second', 'Second', 'Second', 1, 1)");
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c, 2, 'a second profile needs no workspace');
  db.exec("DELETE FROM profiles WHERE id = 'p1'");
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM profile_names').get().c, 0, 'child rows still cascade on delete');
  db.close();
});
function seedAccount(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO users (id, email, password_hash, password_hash_version, signup_status, staff_role, twofa_method, avatar_source, created_at, updated_at)
      VALUES ('admin', 'admin@example.com', 'hash', 1, 'approved', 'owner', 'email', 'identicon', ${now}, ${now});
    INSERT INTO users (id, email, password_hash, password_hash_version, signup_status, staff_role, twofa_method, avatar_source, decided_by, created_at, updated_at)
      VALUES ('u1', 'person@example.com', 'hash', 1, 'approved', 'none', 'email', 'gravatar', 'admin', ${now}, ${now});
    INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, published, created_at, updated_at)
      VALUES ('p1', 'u1', 'person', 'Person', 'Person', 1, ${now}, ${now});
    INSERT INTO public_username_claims (username, username_display, state, pending_user_id, profile_id, created_at)
      VALUES ('person', 'Person', 'active', 'u1', 'p1', ${now});
    INSERT INTO profile_names (id, profile_id, value, position, opinion) VALUES ('n1', 'p1', 'Sam', 0, 'yes');
    INSERT INTO profile_word_groups (id, profile_id, heading, position) VALUES ('g1', 'p1', 'Terms', 0);
    INSERT INTO profile_words (id, group_id, value, opinion, position) VALUES ('w1', 'g1', 'enby', 'yes', 0);
    INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at)
      VALUES ('sess1', 'u1', 'csrf', ${now}, ${now}, ${now + 1000});
    INSERT INTO reauth_challenges (id, user_id, session_id, code_hash, expires_at, created_at)
      VALUES ('re1', 'u1', 'sess1', 'code', ${now + 1000}, ${now});
    INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
      VALUES ('t1', 'u1', 'verify_email', 'hash', ${now + 1000}, ${now});
    INSERT INTO policy_acceptances (id, user_id, terms_version, privacy_version, age_18_attested_at, accepted_at)
      VALUES ('acc1', 'u1', '1', '1', ${now}, ${now});
    INSERT INTO legal_holds (id, user_id, scope, reason, created_by, started_at, review_at)
      VALUES ('hold1', 'u1', 'account', 'inquiry', 'admin', ${now}, ${now + 1000});
    INSERT INTO deletion_requests (id, user_id, active_user_key, status, requested_at, purge_after)
      VALUES ('del1', 'u1', 'u1', 'pending', ${now}, ${now + 1000});
    INSERT INTO deletion_profile_states (deletion_id, profile_id, was_published) VALUES ('del1', 'p1', 1);
    INSERT INTO bans (id, target_type, target_value, scope, created_by, created_at)
      VALUES ('ban1', 'user', 'someone', 'account', 'admin', ${now});
  `);
}
test('relaxing the avatar CHECK rebuilds users without losing a row anywhere', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  await applyThrough(db, '0011_libravatar_avatar_source.sql');
  seedAccount(db);
  await applyFrom(db, '0011_libravatar_avatar_source.sql');
  const counts = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  assert.equal(counts('users'), 2, 'both accounts survive the rebuild');
  assert.equal(db.prepare("SELECT decided_by FROM users WHERE id = 'u1'").get().decided_by, 'admin',
    'the self reference still resolves');
  assert.equal(db.prepare("SELECT avatar_source FROM users WHERE id = 'u1'").get().avatar_source, 'gravatar',
    'an existing choice is carried over');
  for (const table of ['profiles', 'profile_names', 'profile_word_groups', 'profile_words', 'sessions',
    'reauth_challenges', 'email_tokens', 'policy_acceptances', 'legal_holds', 'deletion_requests',
    'deletion_profile_states', 'bans', 'public_username_claims']) {
    assert.equal(counts(table), 1, `${table} keeps its row`);
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.equal(tables.filter((name) => name.startsWith('mig11_')).length, 0, 'no scratch tables are left behind');
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'")
    .all().map((row) => row.name);
  for (const index of ['idx_users_signup_status', 'idx_users_signup_ip_prefix', 'idx_users_password_reset_required']) {
    assert.ok(indexes.includes(index), `${index} is rebuilt`);
  }
  db.exec("UPDATE users SET avatar_source = 'libravatar' WHERE id = 'u1'");
  assert.equal(db.prepare("SELECT avatar_source FROM users WHERE id = 'u1'").get().avatar_source, 'libravatar');
  assert.throws(() => db.exec("UPDATE users SET avatar_source = 'wildcat' WHERE id = 'u1'"),
    /CHECK constraint failed/, 'the constraint still rejects anything else');
  db.exec("DELETE FROM public_username_claims WHERE pending_user_id = 'u1'");
  db.exec("DELETE FROM users WHERE id = 'u1'");
  assert.equal(counts('sessions'), 0, 'account rows still cascade on delete');
  assert.equal(counts('profiles'), 0);
  db.close();
});
test('one migration file serves both backends through guarded sections', async () => {
  for (const file of await migrationFiles()) {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/, `${file} needs no backend suffix`);
  }
  const sql = await readFile(path.join(MIGRATIONS_DIR, '0007_profiles_per_account.sql'), 'utf8');
  const d1 = selectStatements(sql, 'd1').join('\n');
  const postgres = selectStatements(sql, 'postgres').join('\n');
  assert.match(postgres, /ALTER TABLE profiles DROP COLUMN workspace_id/);
  assert.doesNotMatch(postgres, /profiles_new|mig7_/, 'Postgres skips the SQLite rebuild');
  assert.match(d1, /CREATE TABLE profiles_new/);
  assert.doesNotMatch(d1, /DROP COLUMN workspace_id/, 'SQLite skips the unsupported drop');
  for (const shared of ['ALTER TABLE users ADD COLUMN profile_limit', 'DROP TABLE workspaces', 'reserved_until BIGINT']) {
    assert.ok(d1.includes(shared) && postgres.includes(shared), `${shared} runs on both backends`);
  }
  assert.deepEqual(BACKENDS, ['d1', 'postgres']);
});
test('guard markers must be balanced', () => {
  assert.throws(() => selectStatements('-- @d1\nSELECT 1;', 'd1'), /never closes/);
  assert.throws(() => selectStatements('SELECT 1;\n-- @end', 'd1'), /unopened/);
  assert.throws(() => selectStatements('-- @d1\n-- @postgres\nSELECT 1;\n-- @end', 'd1'), /inside/);
});
