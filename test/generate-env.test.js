import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const generatedKeys = [
  'COOKIE_SECRET', 'POLICY_COOKIE_SECRET', 'TOKEN_HASH_KEY', 'ALTCHA_HMAC_KEY',
  'PASSWORD_PEPPER', 'TOTP_ENCRYPTION_KEY', 'CONTENT_FLAG_ENCRYPTION_KEY',
  'BAN_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY', 'POSTGRES_PASSWORD',
];
test('environment generator creates unique correctly sized secrets and refuses overwrite', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-env-test-'));
  const output = path.join(work, '.env');
  try {
    const first = spawnSync('sh', ['scripts/generate-env.sh'], {
      cwd: process.cwd(), env: { ...process.env, ENV_OUTPUT: output }, encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    const values = Object.fromEntries((await readFile(output, 'utf8'))
      .split('\n').filter((line) => line && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(values.NODE_ENV, 'production');
    assert.equal(values.SECURE_COOKIES, 'true');
    assert.equal(values.MAIL_DEV_LOG, 'false');
    for (const key of generatedKeys.slice(0, 5)) assert.equal(values[key].length, 64, key);
    for (const key of generatedKeys.slice(5, 9)) {
      assert.equal(values[key].length, 43, key);
      assert.equal(Buffer.from(values[key], 'base64url').length, 32, key);
    }
    assert.equal(values.POSTGRES_PASSWORD.length, 64);
    assert.equal(new Set(generatedKeys.map((key) => values[key])).size, generatedKeys.length);
    assert.equal(values.DATABASE_URL, `postgres://namelesspronouns:${values.POSTGRES_PASSWORD}@postgres:5432/namelesspronouns`);
    assert.match(first.stdout, /Created production environment file/);
    const second = spawnSync('sh', ['scripts/generate-env.sh'], {
      cwd: process.cwd(), env: { ...process.env, ENV_OUTPUT: output }, encoding: 'utf8',
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Refusing to overwrite/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
