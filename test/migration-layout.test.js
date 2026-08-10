import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../src/db/migrate.js';
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
test('pre-release schema is consolidated into one init migration', async () => {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  assert.deepEqual(files, ['0001_init.sql']);
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
