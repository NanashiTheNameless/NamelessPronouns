import db from './db/index.js';
import { keyedHash } from './util/crypto.js';
import { hasActiveBanForAccount, targetHash } from './bans.js';
export const DENIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUPS = [
  { table: 'sessions', column: 'expires_at' },
  { table: 'login_challenges', column: 'expires_at' },
  { table: 'password_reset_challenges', column: 'expires_at' },
  { table: 'email_tokens', column: 'expires_at' },
  { table: 'email_change_requests', column: 'expires_at' },
  { table: 'altcha_challenges', column: 'expires_at' },
  { table: 'data_export_tokens', column: 'expires_at' },
];
export async function purgeDeniedSignups(now = Date.now()) {
  const { rows } = await db.query(
    `SELECT id, email, signup_ip_prefix_hash FROM users
      WHERE signup_status = 'denied' AND decided_at IS NOT NULL AND decided_at < ?`,
    [now - DENIED_RETENTION_MS],
  );
  let removed = 0;
  let retained = 0;
  for (const user of rows) {
    const banned = await hasActiveBanForAccount({
      userId: user.id, email: user.email, ipPrefixHash: user.signup_ip_prefix_hash, now,
    });
    const hold = banned
      ? null
      : await db.query('SELECT id FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1', [user.id]);
    if (banned || hold.rows.length) {
      retained += 1;
      continue;
    }
    const anon = `deleted:${keyedHash(user.id).slice(0, 32)}`;
    await db.batch([
      { sql: 'UPDATE audit_events SET actor_user_id = ? WHERE actor_user_id = ?', params: [anon, user.id] },
      { sql: 'UPDATE audit_events SET subject_user_id = ? WHERE subject_user_id = ?', params: [anon, user.id] },
      { sql: 'DELETE FROM public_username_claims WHERE pending_user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM content_suspensions WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM content_flags WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM content_rule_exemptions WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM recovery_cases WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM deletion_requests WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM email_change_requests WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM data_export_tokens WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM email_tokens WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM password_reset_challenges WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM policy_acceptances WHERE user_id = ?', params: [user.id] },
      { sql: 'DELETE FROM workspace_invites WHERE invited_by = ?', params: [user.id] },
      { sql: 'DELETE FROM workspace_members WHERE user_id = ?', params: [user.id] },
      { sql: "DELETE FROM workspaces WHERE owner_user_id = ? AND kind = 'personal'", params: [user.id] },
      { sql: "DELETE FROM users WHERE id = ? AND signup_status = 'denied'", params: [user.id] },
    ]);
    removed += 1;
  }
  return { denied_signups_purged: removed, denied_signups_retained: retained };
}
export async function runMaintenance({ now = Date.now(), log = console.log } = {}) {
  const summary = {};
  for (const { table, column } of CLEANUPS) {
    const { rowCount } = await db.query(`DELETE FROM ${table} WHERE ${column} < ?`, [now]);
    summary[table] = rowCount ?? 0;
  }
  const expiredRecovery = await db.query(
    `UPDATE recovery_cases SET status = 'expired', active_user_key = NULL
      WHERE status = 'approved' AND recovery_expires_at < ?`,
    [now],
  );
  summary.recovery_cases = expiredRecovery.rowCount ?? 0;
  const due = await db.query(
    "SELECT id, user_id FROM deletion_requests WHERE status = 'pending' AND purge_after < ?",
    [now],
  );
  let purged = 0;
  for (const deletion of due.rows) {
    const hold = await db.query('SELECT id FROM legal_holds WHERE user_id = ? AND released_at IS NULL LIMIT 1', [deletion.user_id]);
    if (hold.rows.length) {
      await db.query("UPDATE deletion_requests SET status = 'held' WHERE id = ? AND status = 'pending'", [deletion.id]);
      continue;
    }
    const anon = `deleted:${keyedHash(deletion.user_id).slice(0, 32)}`;
    const deletedEmail = `${keyedHash(`deleted-email:${deletion.user_id}`).slice(0, 32)}@deleted.invalid`;
    await db.batch([
      { sql: 'UPDATE audit_events SET actor_user_id = ? WHERE actor_user_id = ?', params: [anon, deletion.user_id] },
      { sql: 'UPDATE audit_events SET subject_user_id = ? WHERE subject_user_id = ?', params: [anon, deletion.user_id] },
      { sql: 'DELETE FROM content_suspensions WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM content_flags WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM content_rule_exemptions WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM recovery_cases WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM email_change_requests WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM data_export_tokens WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM email_tokens WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM recovery_codes WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM login_challenges WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM reauth_challenges WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM policy_acceptances WHERE user_id = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM bans WHERE target_type = ? AND target_hash = ?', params: ['user', targetHash('user', deletion.user_id)] },
      { sql: 'DELETE FROM workspace_invites WHERE invited_by = ?', params: [deletion.user_id] },
      { sql: 'DELETE FROM workspace_members WHERE user_id = ?', params: [deletion.user_id] },
      { sql: `DELETE FROM public_username_claims WHERE pending_user_id = ? OR profile_id IN
                (SELECT p.id FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
                  WHERE w.owner_user_id = ? AND w.kind = 'personal')`, params: [deletion.user_id, deletion.user_id] },
      { sql: "DELETE FROM workspaces WHERE owner_user_id = ? AND kind = 'personal'", params: [deletion.user_id] },
      { sql: `UPDATE users SET email = ?, password_hash = ?, signup_status = 'terminated',
                    requested_profile_username = NULL, requested_profile_username_display = NULL,
                    requested_display_name = NULL, request_note = NULL, email_verified_at = NULL,
                    twofa_method = 'email', totp_secret_ciphertext = NULL, totp_secret_nonce = NULL,
                    totp_key_version = NULL, totp_confirmed_at = NULL, totp_last_step = NULL,
                    avatar_source = 'identicon', avatar_data_uri = NULL,
                    updated_at = ? WHERE id = ?`, params: [deletedEmail, keyedHash(`deleted-password:${deletion.user_id}`), now, deletion.user_id] },
      { sql: "UPDATE deletion_requests SET status = 'completed', active_user_key = NULL, completed_at = ? WHERE id = ?", params: [now, deletion.id] },
    ]);
    purged += 1;
  }
  summary.deletion_requests = purged;
  Object.assign(summary, await purgeDeniedSignups(now));
  log(JSON.stringify({ level: 'info', msg: 'maintenance complete', summary }));
  return summary;
}
export function scheduleMaintenance() {
  const DAY = 24 * 60 * 60 * 1000;
  const handle = setInterval(() => {
    runMaintenance().catch((err) =>
      console.error(JSON.stringify({ level: 'error', msg: 'maintenance failed', error: err.message })),
    );
  }, DAY);
  handle.unref?.();
  return handle;
}
