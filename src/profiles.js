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
        sql: `INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, published, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
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
        sql: `INSERT INTO profiles (id, owner_user_id, username, username_display, display_name, published, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
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
export async function releaseExpiredUsernameHolds(now = Date.now()) {
  const { rowCount } = await db.query(
    "DELETE FROM public_username_claims WHERE state = 'reserved' AND reserved_until IS NOT NULL AND reserved_until < ?",
    [now],
  );
  return rowCount ?? 0;
}
