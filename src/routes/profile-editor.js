import express from 'express';
import db from '../db/index.js';
import config from '../config.js';
import audit from '../audit.js';
import * as mail from '../mail.js';
import * as V from '../validation.js';
import { requireApproved } from '../middleware/session.js';
import { loadCurrentRules } from '../content-rule-store.js';
import { screenContent } from '../content-rules.js';
import { encrypt, keyedHash } from '../util/crypto.js';
import { newId, newToken } from '../util/ids.js';
import { filterExemptMatches } from '../content-exemptions.js';
const router = express.Router();
const ROWS = 3;
function optionalText(value, options) {
  if (value == null || String(value).trim() === '') return null;
  return V.displayText(String(value), options);
}
function optionalProse(value, options) {
  if (value == null || String(value).trim() === '') return null;
  return V.proseText(String(value), options);
}
function formValues(body = {}) {
  return {
    displayName: String(body.display_name ?? ''),
    description: String(body.description ?? ''),
    notes: String(body.notes ?? ''),
    published: body.published === 'on',
    names: Array.from({ length: ROWS }, (_, i) => String(body[`name_${i}`] ?? '')),
    pronouns: Array.from({ length: ROWS }, (_, i) => ({
      subject: String(body[`subject_${i}`] ?? ''),
      object: String(body[`object_${i}`] ?? ''),
      possessiveDeterminer: String(body[`possessive_determiner_${i}`] ?? ''),
      possessivePronoun: String(body[`possessive_pronoun_${i}`] ?? ''),
      reflexive: String(body[`reflexive_${i}`] ?? ''),
    })),
    links: Array.from({ length: ROWS }, (_, i) => ({
      label: String(body[`link_label_${i}`] ?? ''),
      url: String(body[`link_url_${i}`] ?? ''),
    })),
  };
}
export function validateProfileForm(body) {
  const raw = formValues(body);
  const values = {
    displayName: V.displayText(raw.displayName, { field: 'Display name', max: 80 }),
    description: optionalProse(raw.description, { field: 'Description', max: 200 }),
    notes: optionalProse(raw.notes, { field: 'Notes', max: 300 }),
    published: raw.published,
    names: raw.names.map((value) => optionalText(value, { field: 'Name', max: 80 })).filter(Boolean),
    pronouns: [],
    links: [],
  };
  for (const row of raw.pronouns) {
    const present = Object.values(row).some((value) => value.trim() !== '');
    if (!present) continue;
    if (Object.values(row).some((value) => value.trim() === '')) {
      throw new V.ValidationError('Every field in a pronoun set is required.');
    }
    values.pronouns.push({
      subject: V.displayText(row.subject, { field: 'Pronoun subject', max: 40 }),
      object: V.displayText(row.object, { field: 'Pronoun object', max: 40 }),
      possessiveDeterminer: V.displayText(row.possessiveDeterminer, { field: 'Possessive determiner', max: 40 }),
      possessivePronoun: V.displayText(row.possessivePronoun, { field: 'Possessive pronoun', max: 40 }),
      reflexive: V.displayText(row.reflexive, { field: 'Reflexive pronoun', max: 40 }),
    });
  }
  for (const row of raw.links) {
    const hasLabel = row.label.trim() !== '';
    const hasUrl = row.url.trim() !== '';
    if (!hasLabel && !hasUrl) continue;
    if (!hasLabel || !hasUrl) throw new V.ValidationError('Every link needs both a label and URL.');
    values.links.push({
      label: V.displayText(row.label, { field: 'Link label', max: 80 }),
      url: V.httpsUrl(row.url, { field: 'Link URL' }),
    });
  }
  return values;
}
async function editableProfile(profileId, userId) {
  const { rows } = await db.query(
    `SELECT p.id, p.username_display AS username, p.display_name, p.description, p.notes, p.published
       FROM profiles p
       JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = ? AND wm.user_id = ? AND wm.role IN ('owner', 'editor')`,
    [profileId, userId],
  );
  return rows[0] || null;
}
async function editorState(profile) {
  const [names, pronouns, links] = await Promise.all([
    db.query('SELECT value FROM profile_names WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT subject, object, possessive_determiner, possessive_pronoun, reflexive FROM pronoun_sets WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT label, url FROM profile_links WHERE profile_id = ? ORDER BY position', [profile.id]),
  ]);
  return {
    displayName: profile.display_name,
    description: profile.description || '',
    notes: profile.notes || '',
    published: Number(profile.published) === 1,
    names: Array.from({ length: ROWS }, (_, i) => names.rows[i]?.value || ''),
    pronouns: Array.from({ length: ROWS }, (_, i) => ({
      subject: pronouns.rows[i]?.subject || '',
      object: pronouns.rows[i]?.object || '',
      possessiveDeterminer: pronouns.rows[i]?.possessive_determiner || '',
      possessivePronoun: pronouns.rows[i]?.possessive_pronoun || '',
      reflexive: pronouns.rows[i]?.reflexive || '',
    })),
    links: Array.from({ length: ROWS }, (_, i) => ({
      label: links.rows[i]?.label || '', url: links.rows[i]?.url || '',
    })),
  };
}
function screeningInput(values) {
  return {
    text: {
      display_name: values.displayName,
      description: values.description || '',
      notes: values.notes || '',
      names: values.names,
      pronoun_subject: values.pronouns.map((row) => row.subject),
      pronoun_object: values.pronouns.map((row) => row.object),
      pronoun_possessive_determiner: values.pronouns.map((row) => row.possessiveDeterminer),
      pronoun_possessive_pronoun: values.pronouns.map((row) => row.possessivePronoun),
      pronoun_reflexive: values.pronouns.map((row) => row.reflexive),
      link_labels: values.links.map((row) => row.label),
    },
    urls: { links: values.links.map((row) => row.url) },
  };
}
function flagStatements(matches, { user, profileId, saveId, now }) {
  const eligible = autoSuspensionEligible(user.staff_role) ? 1 : 0;
  return matches.map((match) => {
    if (!match.ruleVersionId) throw new Error(`Content rule ${match.ruleId} has no persisted version ID.`);
    const encrypted = encrypt(config.CONTENT_FLAG_ENCRYPTION_KEY, String(match.attemptedValue));
    return {
      sql: `INSERT INTO content_flags
              (id, user_id, profile_id, rule_version_id, field_type, field_index,
               attempted_ciphertext, attempted_nonce, idempotency_key_hash,
               policy_category, severity, mode, auto_suspension_eligible,
               warned_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, idempotency_key_hash, rule_version_id, field_type, field_index) DO NOTHING`,
      params: [
        newId(), user.id, profileId, match.ruleVersionId, match.field,
        match.index ?? -1, encrypted.ciphertext, encrypted.nonce,
        keyedHash(saveId), match.category, match.severity, match.mode, eligible,
        match.mode === 'enforcing' ? now : null, now,
      ],
    };
  });
}
export function autoSuspensionEligible(staffRole) {
  return !['administrator', 'owner'].includes(staffRole);
}
function suspensionStatements({ userId, saveHash, suspensionId, now }) {
  const since = now - 24 * 60 * 60 * 1000;
  const triggerFlag = `SELECT id FROM content_flags
    WHERE user_id = ? AND idempotency_key_hash = ? AND mode = 'enforcing'
      AND auto_suspension_eligible = 1 ORDER BY id LIMIT 1`;
  const distinctCount = `SELECT COUNT(DISTINCT idempotency_key_hash) FROM content_flags
    WHERE user_id = ? AND mode = 'enforcing' AND auto_suspension_eligible = 1
      AND created_at >= ?`;
  return [
    {
      sql: `INSERT INTO content_suspensions
              (id, user_id, trigger_flag_id, active_user_key, threshold_count,
               window_hours, status, created_at)
            SELECT ?, ?, (${triggerFlag}), ?, (${distinctCount}), 24, 'pending', ?
             WHERE (${triggerFlag}) IS NOT NULL
               AND (
                 EXISTS (SELECT 1 FROM content_flags
                   WHERE user_id = ? AND idempotency_key_hash = ?
                     AND mode = 'enforcing' AND auto_suspension_eligible = 1
                     AND severity = 'critical')
                 OR (${distinctCount}) >= 3
               )
            ON CONFLICT (active_user_key) DO NOTHING`,
      params: [
        suspensionId, userId,
        userId, saveHash,
        userId,
        userId, since,
        now,
        userId, saveHash,
        userId, saveHash,
        userId, since,
      ],
    },
    {
      sql: `INSERT INTO content_suspension_profiles (suspension_id, profile_id, was_published)
            SELECT ?, p.id, p.published FROM profiles p
            JOIN workspaces w ON w.id = p.workspace_id
            WHERE w.kind = 'personal' AND w.owner_user_id = ?
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)
            ON CONFLICT (suspension_id, profile_id) DO NOTHING`,
      params: [suspensionId, userId, suspensionId],
    },
    {
      sql: `UPDATE profiles SET published = 0, updated_at = ?
            WHERE workspace_id IN (SELECT id FROM workspaces WHERE kind = 'personal' AND owner_user_id = ?)
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)`,
      params: [now, userId, suspensionId],
    },
    {
      sql: `UPDATE sessions SET revoked_at = ?
            WHERE user_id = ? AND restricted = 0 AND revoked_at IS NULL
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)`,
      params: [now, userId, suspensionId],
    },
    {
      sql: `DELETE FROM login_challenges WHERE user_id = ?
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)`,
      params: [userId, suspensionId],
    },
    {
      sql: `DELETE FROM reauth_challenges WHERE user_id = ?
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)`,
      params: [userId, suspensionId],
    },
  ];
}
function acceptedSaveStatements(profileId, userId, values, now) {
  const revisionId = newId();
  const snapshot = JSON.stringify(values);
  return [
    { sql: 'DELETE FROM profile_names WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM pronoun_sets WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM profile_links WHERE profile_id = ?', params: [profileId] },
    ...values.names.map((value, position) => ({
      sql: 'INSERT INTO profile_names (id, profile_id, value, position) VALUES (?, ?, ?, ?)',
      params: [newId(), profileId, value, position],
    })),
    ...values.pronouns.map((row, position) => ({
      sql: `INSERT INTO pronoun_sets
              (id, profile_id, subject, object, possessive_determiner,
               possessive_pronoun, reflexive, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId(), profileId, row.subject, row.object, row.possessiveDeterminer, row.possessivePronoun, row.reflexive, position],
    })),
    ...values.links.map((row, position) => ({
      sql: 'INSERT INTO profile_links (id, profile_id, label, url, position) VALUES (?, ?, ?, ?, ?)',
      params: [newId(), profileId, row.label, row.url, position],
    })),
    {
      sql: `INSERT INTO profile_revisions
              (id, profile_id, snapshot, created_by, created_at, moderation_state)
            VALUES (?, ?, ?, ?, ?, 'accepted')`,
      params: [revisionId, profileId, snapshot, userId, now],
    },
    {
      sql: `UPDATE profiles
               SET display_name = ?, description = ?, notes = ?, published = ?,
                   accepted_revision_id = ?, updated_at = ?
             WHERE id = ?`,
      params: [values.displayName, values.description, values.notes, values.published ? 1 : 0, revisionId, now, profileId],
    },
  ];
}
router.get('/profiles/:id/edit', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  res.render('profile-edit', {
    title: `Edit ${profile.username}`,
    profile,
    values: await editorState(profile),
    error: null,
    warning: null,
    saved: req.query.saved === '1',
    saveId: newToken(24),
  });
});
router.post('/profiles/:id/edit', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  let values;
  try {
    values = validateProfileForm(req.body);
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('profile-edit', {
      title: `Edit ${profile.username}`, profile, values: formValues(req.body), error: error.message, warning: null, saved: false, saveId: newToken(24),
    });
  }
  const rules = await loadCurrentRules();
  const screened = screenContent(screeningInput(values), rules);
  const filtered = await filterExemptMatches(screened, { userId: req.user.id, profileId: profile.id });
  const matches = filtered.matches;
  await Promise.all(filtered.uses.map(({ exemptionId, match }) => audit.record({
    type: 'content_rule.exemption_used', actorUserId: req.user.id, subjectUserId: req.user.id,
    target: exemptionId, detail: { profileId: profile.id, ruleVersionId: match.ruleVersionId, field: match.field },
  })));
  const enforcing = matches.filter((match) => match.mode === 'enforcing');
  const now = Date.now();
  const saveId = /^[A-Za-z0-9_-]{20,100}$/.test(String(req.body._save_id || ''))
    ? String(req.body._save_id)
    : newToken(24);
  const flags = flagStatements(matches, { user: req.user, profileId: profile.id, saveId, now });
  if (enforcing.length > 0) {
    const suspensionId = newId();
    const saveHash = keyedHash(saveId);
    await db.batch([
      { sql: 'UPDATE users SET updated_at = updated_at WHERE id = ?', params: [req.user.id] },
      ...flags,
      ...suspensionStatements({ userId: req.user.id, saveHash, suspensionId, now }),
    ]);
    const suspended = (await db.query('SELECT id FROM content_suspensions WHERE id = ?', [suspensionId])).rows.length > 0;
    await audit.record({
      type: 'profile.content_reverted', actorUserId: req.user.id, subjectUserId: req.user.id,
      target: profile.id, detail: { categories: [...new Set(enforcing.map((match) => match.category))] },
    });
    mail.contentWarning(req.user.email, [...new Set(enforcing.map((match) => match.category))]).catch(() => {});
    mail.adminActionNeeded('content_flag', `admin:content:${keyedHash(saveId).slice(0, 32)}`).catch(() => {});
    if (suspended) {
      await audit.record({ type: 'content_suspension.created', subjectUserId: req.user.id, target: suspensionId });
      mail.securityNotice(req.user.email, 'Normal account access was temporarily restricted pending content review.').catch(() => {});
      mail.adminActionNeeded('content_suspension', `admin:suspension:${suspensionId}`).catch(() => {});
    }
    return res.status(422).render('profile-edit', {
      title: `Edit ${profile.username}`,
      profile,
      values: await editorState(profile),
      error: null,
      warning: 'That edit matched a prohibited-content rule and was reverted. Do not submit it again. You may request Administrator review if the flag is incorrect.',
      saved: false,
      saveId: newToken(24),
    });
  }
  await db.batch([
    ...flags,
    ...acceptedSaveStatements(profile.id, req.user.id, values, now),
  ]);
  await audit.record({
    type: values.published ? 'profile.saved_published' : 'profile.saved',
    actorUserId: req.user.id,
    subjectUserId: req.user.id,
    target: profile.id,
    detail: { shadowFlags: matches.length },
  });
  res.redirect(`/profiles/${profile.id}/edit?saved=1`);
});
export default router;
