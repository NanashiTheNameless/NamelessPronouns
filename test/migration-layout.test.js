import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../src/db/migrate.js';
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
test('the init schema stays consolidated and later migrations are additive', async () => {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  assert.deepEqual(files, [
    '0001_init.sql',
    '0002_profile_features.sql',
    '0003_profile_words_and_signup_decisions.sql',
    '0004_drop_altcha_challenges.sql',
    '0005_drop_workspace_invites.sql',
  ]);
  const sql = await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /CHECK \(\(user_id IS NOT NULL AND profile_id IS NULL\)/);
  for (const table of [
    'users',
    'bans',
    'workspaces',
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
test('production Compose applies pending migrations before startup', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /command: \["sh", "-c", "node scripts\/migrate\.js && exec node src\/server\.js"\]/);
});
