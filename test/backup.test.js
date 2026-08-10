import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  backupKey, cfRequest, decryptFile, encryptFile, md5, poll, postgresEnvironment, requireEnvironment,
} from '../scripts/backup-lib.js';
const KEY = Buffer.alloc(32, 7).toString('base64');
test('encrypted backups round-trip metadata and SQL without storing plaintext', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-backup-test-'));
  const source = path.join(work, 'source.sql');
  const backup = path.join(work, 'backup.npb');
  const restored = path.join(work, 'restored.sql');
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = KEY;
  try {
    const sql = 'CREATE TABLE example (id INTEGER);\nINSERT INTO example VALUES (1);\n';
    await writeFile(source, sql);
    await encryptFile(source, backup, { backend: 'postgres', format: 'sql', version: 1 });
    const encrypted = await readFile(backup);
    assert.equal(encrypted.includes(Buffer.from('CREATE TABLE')), false);
    assert.deepEqual(await decryptFile(backup, restored), { backend: 'postgres', format: 'sql', version: 1 });
    assert.equal(await readFile(restored, 'utf8'), sql);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
    await rm(work, { recursive: true, force: true });
  }
});
test('backup decryption rejects tampering and invalid containers', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-backup-test-'));
  const source = path.join(work, 'source.sql');
  const backup = path.join(work, 'backup.npb');
  const restored = path.join(work, 'restored.sql');
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = KEY;
  try {
    await writeFile(source, 'SELECT 1;');
    await encryptFile(source, backup, { backend: 'd1', format: 'sql', version: 1 });
    const encrypted = await readFile(backup);
    encrypted[encrypted.length - 1] ^= 1;
    await writeFile(backup, encrypted);
    await assert.rejects(decryptFile(backup, restored));
    await writeFile(backup, 'not a backup');
    await assert.rejects(decryptFile(backup, restored), /Not a NamelessPronouns/);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
    await rm(work, { recursive: true, force: true });
  }
});
test('backup configuration validation is explicit', () => {
  const environment = { PRESENT: 'yes' };
  assert.doesNotThrow(() => requireEnvironment(['PRESENT'], environment));
  assert.throws(() => requireEnvironment(['PRESENT', 'MISSING'], environment), /MISSING/);
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = 'invalid';
  try { assert.throws(() => backupKey(), /32-byte key/); }
  finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  }
  assert.equal(md5(Buffer.from('test')), '098f6bcd4621d373cade4e832627b4f6');
  const pg = postgresEnvironment('postgres://user:p%40ss@db.example:5544/name?sslmode=require', {});
  assert.deepEqual(pg, {
    PGHOST: 'db.example', PGPORT: '5544', PGUSER: 'user', PGPASSWORD: 'p@ss',
    PGDATABASE: 'name', PGSSLMODE: 'require',
  });
  assert.throws(() => postgresEnvironment('https://example.com/db'), /PostgreSQL/);
});
test('D1 API helpers unwrap operations, report API errors, and poll completion', async () => {
  const names = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = `test-${name}`;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: { status: 'complete', result: { signed_url: 'https://example.invalid/export' } } }), { status: 200 });
    assert.equal((await cfRequest('/export', { output_format: 'polling' })).status, 'complete');
    assert.equal((await poll('export', 'bookmark')).status, 'complete');
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'denied' }] }), { status: 403 });
    await assert.rejects(cfRequest('/export', {}), /denied/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
