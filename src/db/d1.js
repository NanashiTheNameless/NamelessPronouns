import config from '../config.js';
const API = 'https://api.cloudflare.com/client/v4';
function endpoint(path) {
  return `${API}/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/d1/database/${config.CLOUDFLARE_D1_DATABASE_ID}${path}`;
}
async function call(path, body) {
  const res = await fetch(endpoint(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.CLOUDFLARE_D1_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const detail = (json.errors || []).map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`D1 API error (${res.status}): ${detail}`);
  }
  return json.result;
}
function toRows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  const rows = first?.results ?? [];
  return { rows, rowCount: first?.meta?.changes ?? rows.length };
}
export function createD1Backend() {
  async function query(sql, params = []) {
    const result = await call('/query', { sql, params });
    return toRows(result);
  }
  async function batch(statements) {
    const batch = statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params ?? [],
    }));
    const result = await call('/query', { batch });
    const parts = Array.isArray(result) ? result : [result];
    return parts.map((r) => toRows(r));
  }
  async function transaction() {
    throw new Error('Interactive transactions are unavailable on D1; use batch()');
  }
  async function ping() {
    await call('/query', { sql: 'SELECT 1', params: [] });
  }
  async function close() {}
  return { backend: 'd1', query, batch, transaction, ping, close };
}
