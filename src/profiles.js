import { newId } from './util/ids.js';
export function personalProfileStatements({ userId, username, usernameDisplay = username, displayName, now = Date.now() }) {
  const workspaceId = newId();
  const membershipId = newId();
  const profileId = newId();
  return {
    workspaceId,
    profileId,
    statements: [
      {
        sql: `INSERT INTO workspaces (id, name, slug, kind, owner_user_id, created_at, updated_at)
              VALUES (?, ?, ?, 'personal', ?, ?, ?)`,
        params: [workspaceId, `${displayName} Workspace`, `personal-${username}`, userId, now, now],
      },
      {
        sql: `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
              VALUES (?, ?, ?, 'owner', ?)`,
        params: [membershipId, workspaceId, userId, now],
      },
      {
        sql: `INSERT INTO profiles (id, workspace_id, username, username_display, display_name, published, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        params: [profileId, workspaceId, username, usernameDisplay, displayName, now, now],
      },
      {
        sql: `UPDATE public_username_claims SET state = 'active', profile_id = ?, pending_user_id = NULL WHERE username = ?`,
        params: [profileId, username],
      },
    ],
  };
}
