import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
const MAGIC = Buffer.from('NPBACKUP1');
export function backupKey() {
  const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}
export function requireEnvironment(names, environment = process.env) {
  const missing = names.filter((name) => !environment[name]);
  if (missing.length) throw new Error(`Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
}
export function postgresEnvironment(databaseUrl, environment = process.env) {
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) {
    throw new Error('DATABASE_URL must identify a PostgreSQL host and database.');
  }
  const result = {
    ...environment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
  };
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) result.PGSSLMODE = sslmode;
  return result;
}
export async function encryptFile(source, destination, metadata) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupKey(), iv);
  const meta = Buffer.from(JSON.stringify(metadata), 'utf8');
  if (meta.length > 65535) throw new Error('Backup metadata is too large.');
  const length = Buffer.alloc(2); length.writeUInt16BE(meta.length);
  const header = Buffer.concat([MAGIC, length, meta, iv, Buffer.alloc(16)]);
  const tagPosition = header.length - 16;
  let output;
  try {
    output = await open(destination, 'wx', 0o600);
    await output.write(header, 0, header.length, 0);
    let position = header.length;
    for await (const chunk of createReadStream(source).pipe(cipher)) {
      await output.write(chunk, 0, chunk.length, position);
      position += chunk.length;
    }
    const tag = cipher.getAuthTag();
    await output.write(tag, 0, tag.length, tagPosition);
    await output.sync();
  } catch (error) {
    await output?.close().catch(() => {});
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  await output.close();
}
export async function decryptFile(source, destination) {
  const sourceSize = (await stat(source)).size;
  if (sourceSize < MAGIC.length + 2 + 12 + 16) {
    throw new Error('Not a NamelessPronouns encrypted backup.');
  }
  const input = await open(source, 'r');
  const prefix = Buffer.alloc(MAGIC.length + 2);
  await input.read(prefix, 0, prefix.length, 0);
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
    await input.close();
    throw new Error('Not a NamelessPronouns encrypted backup.');
  }
  const metaLength = prefix.readUInt16BE(MAGIC.length);
  const metaStart = MAGIC.length + 2; const ivStart = metaStart + metaLength;
  if (ivStart + 28 > sourceSize) { await input.close(); throw new Error('The encrypted backup is truncated.'); }
  const meta = Buffer.alloc(metaLength);
  const iv = Buffer.alloc(12);
  const tag = Buffer.alloc(16);
  await input.read(meta, 0, meta.length, metaStart);
  await input.read(iv, 0, iv.length, ivStart);
  await input.read(tag, 0, tag.length, ivStart + 12);
  await input.close();
  let metadata;
  try { metadata = JSON.parse(meta.toString('utf8')); }
  catch { throw new Error('The encrypted backup metadata is invalid.'); }
  const decipher = createDecipheriv('aes-256-gcm', backupKey(), iv);
  decipher.setAuthTag(tag);
  let output;
  try {
    output = await open(destination, 'wx', 0o600);
    let position = 0;
    const ciphertextStart = ivStart + 28;
    for await (const chunk of createReadStream(source, { start: ciphertextStart }).pipe(decipher)) {
      await output.write(chunk, 0, chunk.length, position);
      position += chunk.length;
    }
    await output.sync();
  } catch (error) {
    await output?.close().catch(() => {});
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  await output.close();
  return metadata;
}
export function md5(buffer) { return createHash('md5').update(buffer).digest('hex'); }
export function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}
export async function cfRequest(path, body) {
  requireEnvironment(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN']);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_D1_DATABASE_ID}${path}`;
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_D1_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const detail = json.errors?.map((entry) => entry.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare D1 operation failed (${response.status})${detail ? `: ${detail}` : '.'}`);
  }
  if (!json.result) throw new Error('Cloudflare D1 returned no operation result.');
  return json.result;
}
export async function poll(operation, bookmark) {
  if (!['export', 'import'].includes(operation) || !bookmark) throw new Error('A valid D1 operation and bookmark are required.');
  let current = bookmark;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await cfRequest(`/${operation}`, operation === 'export'
      ? { output_format: 'polling', current_bookmark: current }
      : { action: 'poll', current_bookmark: current });
    if (result.status === 'complete') return result;
    if (result.status === 'error') throw new Error(`D1 ${operation} failed: ${result.error || 'unknown error'}`);
    current = result.at_bookmark || current;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`D1 ${operation} timed out.`);
}
