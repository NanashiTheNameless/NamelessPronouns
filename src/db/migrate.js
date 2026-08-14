import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import db from './index.js';
const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;
export function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
export async function appliedVersions() {
  await db.query(CREATE_MIGRATIONS_TABLE);
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map((r) => r.version));
}
export const BACKENDS = ['d1', 'postgres'];
export function selectStatements(sql, backend) {
  const kept = [];
  let section = null;
  for (const line of sql.split('\n')) {
    const marker = /^\s*--\s*@(d1|postgres|end)\s*$/.exec(line);
    if (marker) {
      if (marker[1] === 'end') {
        if (section === null) throw new Error('Migration has an unopened -- @end marker.');
        section = null;
      } else {
        if (section !== null) throw new Error(`Migration opens -- @${marker[1]} inside -- @${section}.`);
        section = marker[1];
      }
      continue;
    }
    if (section !== null && section !== backend) continue;
    kept.push(line);
  }
  if (section !== null) throw new Error(`Migration never closes its -- @${section} section.`);
  return splitStatements(kept.join('\n'));
}
export async function pendingMigrations() {
  const applied = await appliedVersions();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return files.filter((f) => !applied.has(f));
}
export async function migrate({ log = console.log } = {}) {
  const pending = await pendingMigrations();
  if (pending.length === 0) {
    log('No pending migrations.');
    return [];
  }
  for (const file of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const statements = selectStatements(sql, db.backend).map((s) => ({ sql: s, params: [] }));
    statements.push({
      sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      params: [file, Date.now()],
    });
    await db.batch(statements);
    log(`Applied ${file}`);
  }
  return pending;
}
export default migrate;
