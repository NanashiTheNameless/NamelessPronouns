import db from './db/index.js';
import logger from './logger.js';
import { newId } from './util/ids.js';
import * as mail from './mail.js';
const NOTIFY_PAGE_SIZE = 200;
export async function forcePasswordResetForEveryone({ reason, actorUserId = null, now = Date.now() }) {
  const mandateId = newId();
  const flagged = await db.query(
    `UPDATE users SET password_reset_required_at = ?, password_reset_required_reason = ?, updated_at = ?
      WHERE signup_status = 'approved'`,
    [now, reason, now],
  );
  const accounts = flagged.rowCount ?? 0;
  const signedOut = await db.query(
    `UPDATE sessions SET revoked_at = ?
      WHERE revoked_at IS NULL
        AND user_id IN (SELECT id FROM users WHERE signup_status = 'approved')`,
    [now],
  );
  await db.batch([
    { sql: "DELETE FROM login_challenges WHERE user_id IN (SELECT id FROM users WHERE signup_status = 'approved')", params: [] },
    { sql: "DELETE FROM reauth_challenges WHERE user_id IN (SELECT id FROM users WHERE signup_status = 'approved')", params: [] },
  ]);
  await db.query(
    `INSERT INTO password_reset_mandates (id, reason, created_by, accounts, sessions_revoked, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [mandateId, reason, actorUserId, accounts, signedOut.rowCount ?? 0, now],
  );
  return { mandateId, accounts, sessionsRevoked: signedOut.rowCount ?? 0 };
}
export async function notifyPasswordResetMandate(mandateId) {
  const { rows } = await db.query('SELECT id, reason FROM password_reset_mandates WHERE id = ?', [mandateId]);
  const mandate = rows[0];
  if (!mandate) return { notified: 0, failed: 0 };
  let notified = 0;
  let failed = 0;
  let after = '';
  for (;;) {
    const page = await db.query(
      `SELECT id, email FROM users
        WHERE signup_status = 'approved' AND password_reset_required_at IS NOT NULL AND id > ?
        ORDER BY id LIMIT ?`,
      [after, NOTIFY_PAGE_SIZE],
    );
    if (page.rows.length === 0) break;
    for (const user of page.rows) {
      try {
        await mail.forcedPasswordResetNotice(user.email, mandate.reason, `password-mandate:${mandate.id}:${user.id}`);
        notified += 1;
      } catch (error) {
        failed += 1;
        logger.error('password mandate notice failed', { error: error.message });
      }
    }
    after = page.rows[page.rows.length - 1].id;
  }
  await db.query(
    'UPDATE password_reset_mandates SET notified = ?, notify_failed = ?, completed_at = ? WHERE id = ?',
    [notified, failed, Date.now(), mandateId],
  );
  return { notified, failed };
}
