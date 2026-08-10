import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { decryptFile, option, md5, cfRequest, poll, postgresEnvironment, requireEnvironment } from './backup-lib.js';
const input = option('input'); const backend = process.env.DB_BACKEND;
if (!input || !['postgres', 'd1'].includes(backend) || option('confirm') !== `RESTORE_${backend.toUpperCase()}`) {
  throw new Error('Restore requires --input=/path/file.npb and --confirm=RESTORE_POSTGRES or RESTORE_D1 matching DB_BACKEND.');
}
if (backend === 'postgres') requireEnvironment(['DATABASE_URL']);
else requireEnvironment(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN']);
const work = await mkdtemp(path.join(tmpdir(), 'np-restore-')); const plain = path.join(work, 'database.sql');
try {
  const metadata = await decryptFile(input, plain);
  if (metadata.backend !== backend || metadata.format !== 'sql') throw new Error(`Backup backend ${metadata.backend} does not match ${backend}.`);
  if (backend === 'postgres') {
    await new Promise((resolve, reject) => {
      const child = spawn('psql', ['--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', plain], {
        stdio: ['ignore', 'inherit', 'inherit'], env: postgresEnvironment(process.env.DATABASE_URL),
      });
      child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`psql exited ${code}`)));
    });
  } else {
    const sql = await readFile(plain); const etag = md5(sql);
    const init = await cfRequest('/import', { action: 'init', etag });
    if (init.upload_url) {
      const upload = await fetch(init.upload_url, { method: 'PUT', body: sql, headers: { 'Content-Type': 'application/sql' }, signal: AbortSignal.timeout(60000) });
      if (!upload.ok) throw new Error(`D1 restore upload failed (${upload.status}).`);
    }
    const ingest = await cfRequest('/import', { action: 'ingest', etag, filename: init.filename });
    if (ingest.status !== 'complete') await poll('import', ingest.at_bookmark);
  }
  console.log(`Restore into ${backend} completed from ${input}`);
} finally { await rm(work, { recursive: true, force: true }); }
