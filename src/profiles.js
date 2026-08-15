import db from './db/index.js';
import config from './config.js';
import { newId } from './util/ids.js';
export const USERNAME_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
export function firstProfileStatements({ userId, username, usernameDisplay = username, displayName, now = Date.now() }) {
  const profileId = newId();
  return {
    profileId,
    statements: [
      {
        sql: `INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, published, is_primary, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        params: [profileId, userId, username, usernameDisplay, displayName, now, now],
      },
      {
        sql: `UPDATE public_username_claims SET state = 'active', profile_id = ?, pending_user_id = NULL,
                     reserved_user_id = NULL, reserved_until = NULL
               WHERE username = ?`,
        params: [profileId, username],
      },
    ],
  };
}
export function additionalProfileStatements({ userId, username, usernameDisplay = username, displayName, now = Date.now() }) {
  const profileId = newId();
  return {
    profileId,
    statements: [
      {
        sql: `INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, published, is_primary, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        params: [profileId, userId, username, usernameDisplay, displayName, now, now],
      },
      {
        sql: 'DELETE FROM public_username_claims WHERE username = ?',
        params: [username],
      },
      {
        sql: `INSERT INTO public_username_claims (username, username_display, state, profile_id, created_at)
              VALUES (?, ?, 'active', ?, ?)`,
        params: [username, usernameDisplay, profileId, now],
      },
    ],
  };
}
export function deleteProfileStatements({ profileId, username, usernameDisplay, userId, now = Date.now() }) {
  return [
    { sql: 'DELETE FROM profiles WHERE id = ?', params: [profileId] },
    { sql: 'DELETE FROM public_username_claims WHERE username = ?', params: [username] },
    {
      sql: `INSERT INTO public_username_claims
              (username, username_display, state, reserved_user_id, reserved_until, created_at)
            VALUES (?, ?, 'reserved', ?, ?, ?)`,
      params: [username, usernameDisplay, userId, now + USERNAME_HOLD_MS, now],
    },
  ];
}
export function profileLimitFor(user) {
  const override = Number(user?.profile_limit);
  if (Number.isFinite(override) && override > 0) return Math.trunc(override);
  return config.MAX_PROFILES_PER_USER;
}
export async function ownedProfileCount(userId) {
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM profiles WHERE owner_user_id = ?', [userId]);
  return Number(rows[0]?.count ?? 0);
}
export async function usernameAvailability(usernameKey, { userId, now = Date.now() } = {}) {
  const { rows } = await db.query(
    'SELECT username, state, reserved_user_id, reserved_until FROM public_username_claims WHERE username = ?',
    [usernameKey],
  );
  const claim = rows[0];
  if (!claim) return { available: true };
  if (claim.state === 'reserved') {
    const until = Number(claim.reserved_until ?? 0);
    if (until <= now) return { available: true, expiredHold: true };
    if (claim.reserved_user_id && claim.reserved_user_id === userId) {
      return { available: true, ownHold: true };
    }
    return { available: false, reason: 'That username is held after a recent deletion. Try again later.' };
  }
  return { available: false, reason: 'That username is unavailable.' };
}
export const MAX_USERNAME_HOLDS = 5;
export async function heldUsernames(userId, now = Date.now()) {
  const { rows } = await db.query(
    `SELECT username_display, reserved_until FROM public_username_claims
      WHERE state = 'reserved' AND reserved_user_id = ? AND reserved_until > ?
      ORDER BY reserved_until`,
    [userId, now],
  );
  return rows.map((row) => ({
    username: row.username_display,
    heldUntil: Number(row.reserved_until),
    daysLeft: Math.max(1, Math.ceil((Number(row.reserved_until) - now) / 86400000)),
  }));
}
export async function releaseOldestHoldStatements(userId, now = Date.now()) {
  const holds = await heldUsernames(userId, now);
  if (holds.length < MAX_USERNAME_HOLDS) return [];
  const excess = holds.slice(0, holds.length - MAX_USERNAME_HOLDS + 1);
  return excess.map((hold) => ({
    sql: "DELETE FROM public_username_claims WHERE state = 'reserved' AND reserved_user_id = ? AND username_display = ?",
    params: [userId, hold.username],
  }));
}
export async function releaseExpiredUsernameHolds(now = Date.now()) {
  const { rowCount } = await db.query(
    "DELETE FROM public_username_claims WHERE state = 'reserved' AND reserved_until IS NOT NULL AND reserved_until < ?",
    [now],
  );
  return rowCount ?? 0;
}
