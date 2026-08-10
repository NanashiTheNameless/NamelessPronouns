import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { encryptFile, option, cfRequest, poll, postgresEnvironment, requireEnvironment } from './backup-lib.js';
const output = option('output');
const backend = process.env.DB_BACKEND;
if (!output || !['postgres', 'd1'].includes(backend)) throw new Error('Usage: yarn backup --output=/secure/path/file.npb (DB_BACKEND=postgres|d1)');
await access(output).then(() => { throw new Error(`Refusing to overwrite existing backup: ${output}`); }, (error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (backend === 'postgres') requireEnvironment(['DATABASE_URL']);
else requireEnvironment(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN']);
const work = await mkdtemp(path.join(tmpdir(), 'np-backup-'));
const plain = path.join(work, 'database.sql');
try {
  if (backend === 'postgres') {
    await new Promise((resolve, reject) => {
      const child = spawn('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', '--file', plain], {
        stdio: ['ignore', 'inherit', 'inherit'], env: postgresEnvironment(process.env.DATABASE_URL),
      });
      child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}`)));
    });
  } else {
    const initial = await cfRequest('/export', { output_format: 'polling' });
    const complete = initial.status === 'complete' ? initial : await poll('export', initial.at_bookmark);
    const response = await fetch(complete.result.signed_url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`D1 export download failed (${response.status}).`);
    await writeFile(plain, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  }
  await encryptFile(plain, output, {
    format: 'sql', backend, createdAt: new Date().toISOString(), version: 1,
    ...(backend === 'd1' ? { databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID } : {}),
  });
  console.log(`Encrypted ${backend} backup written to ${output}`);
} finally {
  const { rm } = await import('node:fs/promises'); await rm(work, { recursive: true, force: true });
}
