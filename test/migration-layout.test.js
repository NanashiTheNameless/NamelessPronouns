import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { splitStatements, selectStatements } from '../src/db/migrate.js';
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
test('the init schema stays consolidated and later migrations are additive', async () => {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  assert.deepEqual(files, [
    '0001_init.sql',
    '0002_profile_features.sql',
    '0003_profile_words_and_signup_decisions.sql',
    '0004_drop_altcha_challenges.sql',
    '0005_drop_workspace_invites.sql',
    '0006_content_exemption_scopes.sql',
    '0007_profiles_per_account.sql',
    '0008_staff_badge_and_primary_profile.sql',
    '0009_profile_owner_constraint.sql',
    '0010_forced_password_resets.sql',
  ]);
  const sql = await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /CHECK \(\(user_id IS NOT NULL AND profile_id IS NULL\)/);
  for (const table of [
    'users',
    'bans',
    'profiles',
    'content_rules',
    'content_flags',
    'content_suspensions',
    'reauth_challenges',
    'password_reset_challenges',
    'data_export_tokens',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.ok(splitStatements(sql).length > 30, 'init contains the complete schema');
});
test('profile features migration adds identity flags and pronoun preferences', async () => {
  const sql = await readFile(new URL('../db/migrations/0002_profile_features.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_identity_flags/);
  assert.match(sql, /FOREIGN KEY \(profile_id\) REFERENCES profiles \(id\) ON DELETE CASCADE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_pronoun_preferences/);
  for (const key of ['any_pronouns', 'ask_me', 'varies', 'use_name', 'no_pronouns', 'mirror_pronouns', 'use_initials', 'alternate_sets']) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
});
test('words migration adds grouped words and opinions to every listed option', async () => {
  const sql = await readFile(new URL('../db/migrations/0003_profile_words_and_signup_decisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_word_groups/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS profile_words/);
  assert.match(sql, /FOREIGN KEY \(group_id\) REFERENCES profile_word_groups \(id\) ON DELETE CASCADE/);
  for (const table of ['profile_names', 'pronoun_sets', 'profile_pronoun_preferences']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN opinion TEXT NOT NULL DEFAULT 'yes'`));
  }
  const checks = sql.match(/CHECK \(opinion IN \('yes', 'jokingly', 'close', 'okay', 'nope'\)\)/g) || [];
  assert.equal(checks.length, 4, 'every opinion column constrains the same five values');
  assert.doesNotMatch(sql, /ALTER TABLE profile_identity_flags/, 'pride flags carry no opinion');
});
test('the same migration records signup decision reasons and a bannable signup IP hash', async () => {
  const sql = await readFile(new URL('../db/migrations/0003_profile_words_and_signup_decisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE users ADD COLUMN decision_reason_public TEXT/);
  assert.match(sql, /ALTER TABLE users ADD COLUMN signup_ip_prefix_hash TEXT/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_users_signup_ip_prefix/);
});
test('users table supports every staff role and the TOTP replay counter', async () => {
  const sql = await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8');
  const check = /CHECK \(staff_role IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(check, 'staff_role has a CHECK constraint');
  const allowed = check[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(allowed, ['none', 'support', 'moderator', 'administrator', 'owner']);
  assert.match(sql, /totp_last_step BIGINT/);
});
test('sessions carry a reauth freshness timestamp', async () => {
  const sql = await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE sessions \([\s\S]*?\breauth_at BIGINT/);
});
test('password reset challenges store only keyed proofs and expire', async () => {
  const sql = await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /email_code_hash TEXT NOT NULL/);
  assert.match(sql, /second_code_hash TEXT/);
  assert.match(sql, /expires_at BIGINT NOT NULL/);
});
test('ALTCHA replay records are no longer persisted', async () => {
  const sql = await readFile(new URL('../db/migrations/0004_drop_altcha_challenges.sql', import.meta.url), 'utf8');
  assert.match(sql, /DROP TABLE IF EXISTS altcha_challenges/);
  const source = await readFile(new URL('../src/altcha.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /altcha_challenges/, 'verification touches no table');
});
test('shared-workspace invites are gone from the schema and the application', async () => {
  const sql = await readFile(new URL('../db/migrations/0005_drop_workspace_invites.sql', import.meta.url), 'utf8');
  assert.match(sql, /DROP TABLE IF EXISTS workspace_invites/);
  for (const file of ['../src/maintenance.js', '../src/ratelimit.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /workspace_invites|invite_accept_ip|invite_send_workspace/);
  }
});
test('profiles hang off accounts, and workspaces are gone entirely', async () => {
  const sql = await readFile(new URL('../db/migrations/0007_profiles_per_account.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE profiles ADD COLUMN owner_user_id TEXT/);
  assert.match(sql, /UPDATE profiles SET owner_user_id/, 'existing profiles keep their owner');
  assert.match(sql, /DROP TABLE workspace_members/);
  assert.match(sql, /DROP TABLE workspaces/);
  const postgres = selectStatements(sql, 'postgres').join('\n');
  assert.match(postgres, /ALTER TABLE profiles DROP COLUMN workspace_id/);
  const d1 = selectStatements(sql, 'd1').join('\n');
  assert.doesNotMatch(d1, /ALTER TABLE profiles DROP COLUMN/, 'SQLite cannot drop a column named in a foreign key');
  assert.match(d1, /CREATE TABLE profiles_new/, 'SQLite rebuilds the table instead');
  assert.match(d1, /ALTER TABLE profiles_new RENAME TO profiles/);
  for (const child of ['profile_names', 'pronoun_sets', 'profile_links', 'profile_words']) {
    assert.match(d1, new RegExp(`CREATE TABLE mig7_${child} AS SELECT \\* FROM ${child}`), `${child} is copied out first`);
    assert.match(d1, new RegExp(`INSERT INTO ${child} SELECT \\* FROM mig7_${child}`), `${child} is restored after`);
    assert.match(d1, new RegExp(`DROP TABLE mig7_${child}`), `the ${child} scratch copy is removed`);
  }
  const sources = ['../src/profiles.js', '../src/data-export.js', '../src/maintenance.js', '../src/server.js',
    '../src/routes/profile-editor.js', '../src/routes/public-profile.js', '../src/routes/account.js',
    '../src/routes/admin-management.js', '../src/routes/admin.js', '../src/routes/content-rule-admin.js'];
  for (const file of sources) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /workspace/i, `${file} speaks only of accounts and profiles`);
  }
});
test('content exemptions become scopeable, readable, and editable', async () => {
  const sql = await readFile(new URL('../db/migrations/0006_content_exemption_scopes.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE content_rule_exemptions_new \(/);
  for (const column of ['rule_version_id TEXT,', 'field_type TEXT,', 'normalized_value TEXT,', 'updated_at BIGINT,', 'updated_by TEXT,']) {
    assert.match(sql, new RegExp(`\\s${column.replace(/[()]/g, '\\$&')}`), `${column} is nullable`);
  }
  assert.match(sql, /INSERT INTO content_rule_exemptions_new/, 'existing exemptions are carried over');
  assert.match(sql, /ALTER TABLE content_rule_exemptions_new RENAME TO content_rule_exemptions/);
  assert.match(sql, /CREATE INDEX idx_content_exemptions_rule ON content_rule_exemptions \(rule_version_id, normalized_value\)/);
  const source = await readFile(new URL('../src/content-exemptions.js', import.meta.url), 'utf8');
  assert.match(source, /rule_version_id IS NULL OR rule_version_id = \?/, 'a null rule version covers every rule');
  assert.match(source, /field_type IS NULL OR field_type = \?/, 'a null field covers every field');
});
test('production Compose applies pending migrations before startup', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /command: \["sh", "-c", "node scripts\/migrate\.js && exec node src\/server\.js"\]/);
});

test('the badge and primary-profile migration is additive and backfills the first profile', async () => {
  const sql = await readFile(new URL('../db/migrations/0008_staff_badge_and_primary_profile.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE profiles ADD COLUMN staff_badge_hidden INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /ALTER TABLE profiles ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /UPDATE profiles SET is_primary = 1 WHERE NOT EXISTS/, 'the oldest profile of each account becomes primary');
  assert.doesNotMatch(sql, /-- @(d1|postgres)/, 'both backends take the same statements');
});

test('the forced-reset migration flags accounts and records every mandate', async () => {
  const sql = await readFile(new URL('../db/migrations/0010_forced_password_resets.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE users ADD COLUMN password_reset_required_at BIGINT/);
  assert.match(sql, /ALTER TABLE users ADD COLUMN password_reset_required_reason TEXT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS password_reset_mandates/);
  assert.match(sql, /sessions_revoked INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /FOREIGN KEY \(created_by\) REFERENCES users \(id\)/);
  assert.doesNotMatch(sql, /DROP TABLE/i, 'the migration stays additive');
});
test('Postgres gains the profile owner constraint SQLite already had', async () => {
  const sql = await readFile(new URL('../db/migrations/0009_profile_owner_constraint.sql', import.meta.url), 'utf8');
  const postgres = selectStatements(sql, 'postgres').join('\n');
  const d1 = selectStatements(sql, 'd1').join('\n');
  assert.match(postgres, /ALTER COLUMN owner_user_id SET NOT NULL/);
  assert.match(postgres, /FOREIGN KEY \(owner_user_id\) REFERENCES users \(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(d1, /ALTER (COLUMN|TABLE profiles ADD CONSTRAINT)/, 'SQLite built the constraint into the rebuilt table');
  for (const both of ['DELETE FROM profiles WHERE owner_user_id IS NULL']) {
    assert.ok(postgres.includes(both) && d1.includes(both), 'orphan cleanup runs on both backends');
  }
});
