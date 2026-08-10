import { newId } from './util/ids.js';
import { personalProfileStatements } from './profiles.js';

export function ownerBootstrapStatements({ email, passwordHash, passwordHashVersion, username = null, now = Date.now() }) {
  const userId = newId();
  const usernameKey = username?.key ?? null;
  const usernameDisplay = username?.display ?? null;
  const statements = [
    {
      sql: `INSERT INTO users
              (id, email, password_hash, password_hash_version, email_verified_at,
               signup_status, requested_profile_username, requested_profile_username_display,
               requested_display_name, staff_role, twofa_method, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, 'owner', 'email', ?, ?)`,
      params: [userId, email, passwordHash, passwordHashVersion, now, usernameKey, usernameDisplay, usernameDisplay, now, now],
    },
  ];
  if (username) {
    statements.push(
      {
        sql: `INSERT INTO public_username_claims
                (username, username_display, state, pending_user_id, requested_display_name, created_at)
              VALUES (?, ?, 'pending', ?, ?, ?)`,
        params: [usernameKey, usernameDisplay, userId, usernameDisplay, now],
      },
      ...personalProfileStatements({
        userId,
        username: usernameKey,
        usernameDisplay,
        displayName: usernameDisplay,
        now,
      }).statements,
    );
  }
  statements.push({
    sql: `INSERT INTO audit_events (id, event_type, actor_user_id, subject_user_id, created_at)
          VALUES (?, 'owner.bootstrap_created', ?, ?, ?)`,
    params: [newId(), userId, userId, now],
  });
  return { userId, statements };
}
