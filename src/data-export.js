import yazl from 'yazl';
import db from './db/index.js';
const WORKSPACE_SCOPE = `
  owner_user_id = ? OR id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = ?
  )`;
export async function collectUserData(userId, { generatedAt = new Date().toISOString() } = {}) {
  const account = await db.query(
    `SELECT id, email, email_verified_at, signup_status,
            requested_profile_username, requested_profile_username_display,
            requested_display_name, request_note, requested_at, decided_at,
            decided_by, decision_note, staff_role, twofa_method,
            email_login_disabled, avatar_source, avatar_data_uri, created_at, updated_at
       FROM users WHERE id = ?`,
    [userId],
  );
  const policyAcceptances = await db.query(
    `SELECT id, user_id, terms_version, privacy_version, age_18_attested_at,
            accepted_at, keyed_ip_hash
       FROM policy_acceptances WHERE user_id = ? ORDER BY accepted_at`,
    [userId],
  );
  const workspaces = await db.query(
    `SELECT id, name, slug, kind, owner_user_id, created_at, updated_at
       FROM workspaces WHERE ${WORKSPACE_SCOPE} ORDER BY created_at, id`,
    [userId, userId],
  );
  const workspaceMembers = await db.query(
    `SELECT id, workspace_id, user_id, role, created_at
       FROM workspace_members
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE ${WORKSPACE_SCOPE})
      ORDER BY workspace_id, created_at, id`,
    [userId, userId],
  );
  const profiles = await db.query(
    `SELECT id, workspace_id, username, username_display, display_name,
            description, notes, theme, published, accepted_revision_id,
            created_at, updated_at
       FROM profiles
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE ${WORKSPACE_SCOPE})
      ORDER BY created_at, id`,
    [userId, userId],
  );
  const profileScope = `profile_id IN (
    SELECT id FROM profiles WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE ${WORKSPACE_SCOPE}
    )
  )`;
  const profileNames = await db.query(
    `SELECT id, profile_id, value, opinion, position FROM profile_names
      WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const pronounSets = await db.query(
    `SELECT id, profile_id, subject, object, possessive_determiner,
            possessive_pronoun, reflexive, opinion, position
       FROM pronoun_sets WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const profileWordGroups = await db.query(
    `SELECT id, profile_id, heading, position FROM profile_word_groups
      WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const profileWords = await db.query(
    `SELECT id, group_id, value, opinion, position FROM profile_words
      WHERE group_id IN (SELECT id FROM profile_word_groups WHERE ${profileScope})
      ORDER BY group_id, position`,
    [userId, userId],
  );
  const profileLinks = await db.query(
    `SELECT id, profile_id, label, url, position FROM profile_links
      WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const profileIdentityFlags = await db.query(
    `SELECT id, profile_id, flag_key, opinion, position FROM profile_identity_flags
      WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const profilePronounPreferences = await db.query(
    `SELECT profile_id, preference_key, opinion, position FROM profile_pronoun_preferences
      WHERE ${profileScope} ORDER BY profile_id, position`,
    [userId, userId],
  );
  const usernameClaims = await db.query(
    `SELECT username, username_display, state, pending_user_id,
            requested_display_name, profile_id, created_at
       FROM public_username_claims
      WHERE pending_user_id = ? OR profile_id IN (
        SELECT id FROM profiles WHERE workspace_id IN (
          SELECT id FROM workspaces WHERE ${WORKSPACE_SCOPE}
        )
      )
      ORDER BY created_at, username`,
    [userId, userId, userId],
  );
  const auditEvents = await db.query(
    `SELECT id, event_type, actor_user_id, subject_user_id, target, ip_hash,
            detail, created_at
       FROM audit_events
      WHERE subject_user_id = ? OR actor_user_id = ?
      ORDER BY created_at, id`,
    [userId, userId],
  );
  return {
    generated_at: generatedAt,
    account: account.rows[0] || null,
    policy_acceptances: policyAcceptances.rows,
    workspaces: workspaces.rows,
    workspace_members: workspaceMembers.rows,
    profiles: profiles.rows,
    profile_names: profileNames.rows,
    pronoun_sets: pronounSets.rows,
    profile_word_groups: profileWordGroups.rows,
    profile_words: profileWords.rows,
    profile_links: profileLinks.rows,
    profile_identity_flags: profileIdentityFlags.rows,
    profile_pronoun_preferences: profilePronounPreferences.rows,
    public_username_claims: usernameClaims.rows,
    audit_events: auditEvents.rows,
  };
}
function readme(generatedAt) {
  return `NamelessPronouns account data export
Generated at: ${generatedAt}
This archive contains two versions of the same account data:
- user-friendly/: Plain-text files with readable labels and dates.
- machine-readable/: JSON files retaining the stored field names and values.
Machine-readable timestamps are UTC Unix milliseconds unless a field is an ISO
date string. Authentication secrets, password hashes, one-time token hashes,
sessions, bans, and encrypted moderation evidence are intentionally excluded.
`;
}
function humanLabel(name) {
  return String(name)
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
function humanValue(key, value) {
  if (value == null) return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'published' || key === 'email_login_disabled') {
    return Number(value) === 1 ? 'Yes' : 'No';
  }
  if (key.endsWith('_at') && /^\d+$/.test(String(value))) {
    const date = new Date(Number(value));
    if (!Number.isNaN(date.getTime())) return `${date.toISOString()} (${value})`;
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
function humanRecord(record) {
  return Object.entries(record)
    .map(([key, value]) => {
      const rendered = humanValue(key, value).replaceAll('\n', '\n  ');
      return `${humanLabel(key)}: ${rendered}`;
    })
    .join('\n');
}
export function formatUserFriendlyDataset(name, value) {
  const heading = humanLabel(name);
  const rule = '='.repeat(heading.length);
  if (value == null) return `${heading}\n${rule}\n\nNo data is available.\n`;
  if (!Array.isArray(value)) return `${heading}\n${rule}\n\n${humanRecord(value)}\n`;
  if (value.length === 0) return `${heading}\n${rule}\n\nNo records.\n`;
  const records = value.map((record, index) => `Record ${index + 1}\n--------\n${humanRecord(record)}`);
  return `${heading}\n${rule}\n\n${records.join('\n\n')}\n`;
}
export function exportFilename(generatedAt = Date.now()) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError('Export filename timestamp must be a valid date');
  const calendarDate = date.toISOString().slice(0, 10).replaceAll('-', '.');
  const unixTime = Math.floor(date.getTime() / 1000);
  return `NamelessPronouns-${calendarDate}-${unixTime}.zip`;
}
export function buildExportZip(data) {
  const zip = new yazl.ZipFile();
  const acceptedAt = new Date(data.generated_at);
  if (Number.isNaN(acceptedAt.getTime())) throw new TypeError('Export generated_at must be a valid date');
  const options = { mtime: acceptedAt, compress: true };
  zip.addBuffer(Buffer.from(readme(data.generated_at), 'utf8'), 'README.txt', options);
  zip.addBuffer(
    Buffer.from(`${JSON.stringify({ generated_at: data.generated_at }, null, 2)}\n`, 'utf8'),
    'machine-readable/export-metadata.json',
    options,
  );
  zip.addBuffer(
    Buffer.from(`Export metadata\n===============\n\nGenerated at: ${data.generated_at}\n`, 'utf8'),
    'user-friendly/export-metadata.txt',
    options,
  );
  for (const [name, value] of Object.entries(data)) {
    if (name === 'generated_at') continue;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    zip.addBuffer(Buffer.from(json, 'utf8'), `machine-readable/${name}.json`, options);
    zip.addBuffer(
      Buffer.from(formatUserFriendlyDataset(name, value), 'utf8'),
      `user-friendly/${name}.txt`,
      options,
    );
  }
  return zip;
}
