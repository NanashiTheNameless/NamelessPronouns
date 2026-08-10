import config from '../config.js';
import { createPostgresBackend } from './postgres.js';
import { createD1Backend } from './d1.js';
function createBackend() {
  return config.DB_BACKEND === 'd1' ? createD1Backend() : createPostgresBackend();
}
export const db = createBackend();
export default db;
