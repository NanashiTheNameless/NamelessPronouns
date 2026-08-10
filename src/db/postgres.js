import pg from 'pg';
import config from '../config.js';
const { Pool } = pg;
export function rewrite(sql) {
  let n = 0;
  let out = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") inSingle = !inSingle;
    if (c === '?' && !inSingle) out += `$${++n}`;
    else out += c;
  }
  return out;
}
export function createPostgresBackend() {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
  async function query(sql, params = []) {
    const res = await pool.query(rewrite(sql), params);
    return { rows: res.rows, rowCount: res.rowCount };
  }
  async function batch(statements) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const { sql, params = [] } of statements) {
        const res = await client.query(rewrite(sql), params);
        results.push({ rows: res.rows, rowCount: res.rowCount });
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  async function transaction(fn) {
    const client = await pool.connect();
    const tx = {
      async query(sql, params = []) {
        const res = await client.query(rewrite(sql), params);
        return { rows: res.rows, rowCount: res.rowCount };
      },
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  async function ping() {
    await pool.query('SELECT 1');
  }
  async function close() {
    await pool.end();
  }
  return { backend: 'postgres', query, batch, transaction, ping, close };
}
