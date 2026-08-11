import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildExportZip, exportFilename } from '../src/data-export.js';
async function zipBuffer(data) {
  const zip = buildExportZip(data);
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.once('end', resolve);
    zip.outputStream.once('error', reject);
  });
  zip.end();
  await complete;
  return Buffer.concat(chunks);
}
test('account export has valid user-friendly and machine-readable versions', async () => {
  const generatedAt = '2026-08-09T12:34:56.000Z';
  const archive = await zipBuffer({
    generated_at: generatedAt,
    account: { id: 'user-1', email: 'user@example.com' },
    profiles: [{ id: 'profile-1', display_name: 'Example' }],
  });
  assert.deepEqual(archive.subarray(0, 4), Buffer.from('PK\x03\x04', 'binary'));
  const dir = await mkdtemp(join(tmpdir(), 'nameless-export-test-'));
  const path = join(dir, 'export.zip');
  try {
    await writeFile(path, archive);
    const tested = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.equal(tested.status, 0, tested.stdout || tested.stderr);
    const listed = spawnSync('unzip', ['-Z1', path], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n').sort(), [
      'README.txt',
      'machine-readable/account.json',
      'machine-readable/export-metadata.json',
      'machine-readable/profiles.json',
      'user-friendly/account.txt',
      'user-friendly/export-metadata.txt',
      'user-friendly/profiles.txt',
    ]);
    const account = spawnSync('unzip', ['-p', path, 'machine-readable/account.json'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(account.stdout), { id: 'user-1', email: 'user@example.com' });
    const friendly = spawnSync('unzip', ['-p', path, 'user-friendly/account.txt'], { encoding: 'utf8' });
    assert.match(friendly.stdout, /Account\n=======/);
    assert.match(friendly.stdout, /Email: user@example\.com/);
    assert.doesNotMatch(friendly.stdout, /[{}\[\]"]/);
    const metadata = spawnSync('unzip', ['-p', path, 'machine-readable/export-metadata.json'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(metadata.stdout), { generated_at: generatedAt, owned_by: 'you' });
    const readme = spawnSync('unzip', ['-p', path, 'README.txt'], { encoding: 'utf8' });
    assert.ok(readme.stdout.includes(generatedAt));
    const central = archive.indexOf(Buffer.from('PK\x01\x02', 'binary'));
    assert.ok(central > 0, 'central directory is present');
    const dosTime = archive.readUInt16LE(central + 12);
    const dosDate = archive.readUInt16LE(central + 14);
    const acceptedAt = new Date(generatedAt);
    assert.equal(1980 + (dosDate >> 9), acceptedAt.getFullYear());
    assert.equal((dosDate >> 5) & 0x0f, acceptedAt.getMonth() + 1);
    assert.equal(dosDate & 0x1f, acceptedAt.getDate());
    assert.equal(dosTime >> 11, acceptedAt.getHours());
    assert.equal((dosTime >> 5) & 0x3f, acceptedAt.getMinutes());
    assert.equal((dosTime & 0x1f) * 2, acceptedAt.getSeconds());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('account export filename includes UTC date and Unix time', () => {
  assert.equal(
    exportFilename('2026-08-09T12:34:56.000Z'),
    'NamelessPronouns-2026.08.09-1786278896.zip',
  );
  assert.throws(() => exportFilename('invalid'), /valid date/);
});
