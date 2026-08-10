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
import { consume } from '../ratelimit.js';
import { PRONOUN_PREFERENCES } from '../pronoun-preferences.js';
import { PRONOUN_PRESETS } from '../pronoun-presets.js';
import { DEFAULT_OPINION, isOpinion, normalizeOpinion, OPINIONS } from '../opinions.js';
import { groupProfileWords, PROFILE_WORD_GROUPS_SQL, PROFILE_WORDS_SQL } from '../profile-words.js';
import {
  emptyFlag,
  emptyLink,
  emptyName,
  emptyPronoun,
  emptyWordGroup,
  fetchPronounsPageProfile,
  flagLabel,
  mapPronounsPageProfile,
  pronounsPageFlagUrl,
  PRONOUNS_PAGE_FLAG_OPTIONS,
} from '../pronouns-page-import.js';
const router = express.Router();
const MAX_ROWS = 25;
const PRONOUN_FORM_FIELDS = ['subject', 'object', 'possessiveDeterminer', 'possessivePronoun', 'reflexive'];
const FLAG_OPTIONS = Object.freeze(PRONOUNS_PAGE_FLAG_OPTIONS.map((key) => Object.freeze({
  key,
  label: flagLabel(key),
  imageUrl: pronounsPageFlagUrl(key),
})));
function editorView(profile, values, overrides = {}) {
  return {
    title: `Edit ${profile.username}`,
    profile,
    values,
    error: null,
    warning: null,
    saved: false,
    importNotice: null,
    flagOptions: FLAG_OPTIONS,
    pronounPreferenceOptions: PRONOUN_PREFERENCES,
    pronounPresetOptions: PRONOUN_PRESETS,
    opinionOptions: OPINIONS,
    saveId: newToken(24),
    ...overrides,
  };
}
function optionalProse(value, options) {
  if (value == null || String(value).trim() === '') return null;
  return V.proseText(String(value), options);
}
function lineText(value, options) {
  return V.proseText(String(value).replace(/[\r\n]+/g, ' '), options);
}
function pronounText(value, field) {
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 40 || !/^[A-Za-z0-9/'-]+$/.test(normalized)) {
    throw new V.ValidationError(`${field} may contain only letters, numbers, slashes, apostrophes, and dashes.`);
  }
  return normalized;
}
function arrayField(body, name, legacyPrefix) {
  if (body[name] !== undefined) return (Array.isArray(body[name]) ? body[name] : [body[name]]).slice(0, MAX_ROWS);
  const indexes = Object.keys(body)
    .map((key) => new RegExp(`^${legacyPrefix}_(\\d+)$`).exec(key))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const count = indexes.length ? Math.min(Math.max(...indexes) + 1, MAX_ROWS) : 1;
  return Array.from({ length: count }, (_, index) => body[`${legacyPrefix}_${index}`] ?? '');
}
function opinionField(body, name, index) {
  return normalizeOpinion(String(arrayField(body, name, name)[index] ?? ''));
}
function selectedOpinion(value) {
  const raw = String(value ?? '');
  const opinion = raw === 'on' ? DEFAULT_OPINION : raw;
  return isOpinion(opinion) ? opinion : null;
}
function wordGroupValues(body) {
  return arrayField(body, 'word_group_heading', 'word_group_heading').map((heading, index) => {
    const values = arrayField(body, `word_value_${index}`, `word_value_${index}`);
    const opinions = arrayField(body, `word_opinion_${index}`, `word_opinion_${index}`);
    return {
      heading: String(heading ?? ''),
      words: values.map((value, i) => ({
        value: String(value ?? ''),
        opinion: normalizeOpinion(String(opinions[i] ?? '')),
      })),
    };
  });
}
function formValues(body = {}) {
  const names = arrayField(body, 'name', 'name');
  const subjects = arrayField(body, 'subject', 'subject');
  const objects = arrayField(body, 'object', 'object');
  const determiners = arrayField(body, 'possessive_determiner', 'possessive_determiner');
  const possessives = arrayField(body, 'possessive_pronoun', 'possessive_pronoun');
  const reflexives = arrayField(body, 'reflexive', 'reflexive');
  const linkLabels = arrayField(body, 'link_label', 'link_label');
  const linkUrls = arrayField(body, 'link_url', 'link_url');
  return {
    displayName: String(body.display_name ?? ''),
    description: String(body.description ?? ''),
    notes: String(body.notes ?? ''),
    published: body.published === 'on',
    names: names.map((value, i) => ({
      value: String(value ?? ''),
      opinion: opinionField(body, 'name_opinion', i),
    })),
    pronouns: subjects.map((value, i) => ({
      subject: String(value ?? ''),
      object: String(objects[i] ?? ''),
      possessiveDeterminer: String(determiners[i] ?? ''),
      possessivePronoun: String(possessives[i] ?? ''),
      reflexive: String(reflexives[i] ?? ''),
      opinion: opinionField(body, 'pronoun_opinion', i),
    })),
    links: linkLabels.map((value, i) => ({
      label: String(value ?? ''),
      url: String(linkUrls[i] ?? ''),
    })),
    flags: arrayField(body, 'profile_flag', 'profile_flag').map((key, i) => ({
      key: String(key ?? ''),
      opinion: opinionField(body, 'profile_flag_opinion', i),
    })),
    words: wordGroupValues(body),
    pronounPreferences: PRONOUN_PREFERENCES
      .map((preference) => ({
        key: preference.key,
        opinion: selectedOpinion(body[`pronoun_pref_${preference.key}`]),
      }))
      .filter((preference) => preference.opinion !== null),
  };
}
export function validateProfileForm(body) {
  const raw = formValues(body);
  const values = {
    displayName: V.displayText(raw.displayName, { field: 'Display name', max: 80 }),
    description: optionalProse(raw.description, { field: 'Description', max: 200 }),
    notes: optionalProse(raw.notes, { field: 'Notes', max: 300 }),
    published: raw.published,
    names: raw.names
      .filter((row) => row.value.trim() !== '')
      .map((row) => ({
        value: V.displayText(row.value, { field: 'Name', max: 80 }),
        opinion: row.opinion,
      })),
    pronouns: [],
    words: [],
    links: [],
    flags: [],
    pronounPreferences: raw.pronounPreferences,
  };
  for (const row of raw.pronouns) {
    const forms = PRONOUN_FORM_FIELDS.map((field) => row[field]);
    if (forms.every((value) => value.trim() === '')) continue;
    if (forms.some((value) => value.trim() === '')) {
      throw new V.ValidationError('Every field in a pronoun set is required.');
    }
    values.pronouns.push({
      subject: pronounText(row.subject, 'Pronoun subject'),
      object: pronounText(row.object, 'Pronoun object'),
      possessiveDeterminer: pronounText(row.possessiveDeterminer, 'Possessive determiner'),
      possessivePronoun: pronounText(row.possessivePronoun, 'Possessive pronoun'),
      reflexive: pronounText(row.reflexive, 'Reflexive pronoun'),
      opinion: row.opinion,
    });
  }
  for (const group of raw.words) {
    const heading = group.heading.trim();
    const words = group.words.filter((word) => word.value.trim() !== '');
    if (!heading && words.length === 0) continue;
    if (!heading) throw new V.ValidationError('Every word group needs a heading.');
    if (words.length === 0) throw new V.ValidationError('Every word group needs at least one word.');
    values.words.push({
      heading: lineText(heading, { field: 'Word group heading', max: 80 }),
      words: words.map((word) => ({
        value: lineText(word.value, { field: 'Word', max: 80 }),
        opinion: word.opinion,
      })),
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
  for (const row of raw.flags) {
    const flag = row.key.trim();
    if (!flag) continue;
    if (!PRONOUNS_PAGE_FLAG_OPTIONS.includes(flag)) throw new V.ValidationError('Choose a flag from the available Pronouns.page flags.');
    values.flags.push({ key: flag, opinion: row.opinion });
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
async function profileWords(profileId) {
  const [groups, words] = await Promise.all([
    db.query(PROFILE_WORD_GROUPS_SQL, [profileId]),
    db.query(PROFILE_WORDS_SQL, [profileId]),
  ]);
  return groupProfileWords(groups.rows, words.rows);
}
async function editorState(profile) {
  const [names, pronouns, links, flags, pronounPreferences, words] = await Promise.all([
    db.query('SELECT value, opinion FROM profile_names WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT subject, object, possessive_determiner, possessive_pronoun, reflexive, opinion FROM pronoun_sets WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT label, url FROM profile_links WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT flag_key, opinion FROM profile_identity_flags WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT preference_key, opinion FROM profile_pronoun_preferences WHERE profile_id = ? ORDER BY position', [profile.id]),
    profileWords(profile.id),
  ]);
  return {
    displayName: profile.display_name,
    description: profile.description || '',
    notes: profile.notes || '',
    published: Number(profile.published) === 1,
    names: names.rows.length
      ? names.rows.map((row) => ({ value: row.value, opinion: row.opinion }))
      : [emptyName()],
    pronouns: pronouns.rows.length ? pronouns.rows.map((row) => ({
      subject: row.subject,
      object: row.object,
      possessiveDeterminer: row.possessive_determiner,
      possessivePronoun: row.possessive_pronoun,
      reflexive: row.reflexive,
      opinion: row.opinion,
    })) : [emptyPronoun()],
    words: words.length ? words : [emptyWordGroup()],
    links: links.rows.length ? links.rows.map((row) => ({ label: row.label, url: row.url })) : [emptyLink()],
    flags: flags.rows.length
      ? flags.rows.map((row) => ({ key: row.flag_key, opinion: row.opinion }))
      : [emptyFlag()],
    pronounPreferences: pronounPreferences.rows.map((row) => ({ key: row.preference_key, opinion: row.opinion })),
  };
}
function screeningInput(values) {
  return {
    text: {
      display_name: values.displayName,
      description: values.description || '',
      notes: values.notes || '',
      names: values.names.map((row) => row.value),
      word_group_headings: values.words.map((group) => group.heading),
      words: values.words.flatMap((group) => group.words.map((word) => word.value)),
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
  const wordGroupIds = values.words.map(() => newId());
  const snapshot = JSON.stringify(values);
  return [
    { sql: 'DELETE FROM profile_names WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM pronoun_sets WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM profile_links WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM profile_identity_flags WHERE profile_id = ?', params: [profileId] },
    { sql: 'DELETE FROM profile_pronoun_preferences WHERE profile_id = ?', params: [profileId] },
    {
      sql: 'DELETE FROM profile_words WHERE group_id IN (SELECT id FROM profile_word_groups WHERE profile_id = ?)',
      params: [profileId],
    },
    { sql: 'DELETE FROM profile_word_groups WHERE profile_id = ?', params: [profileId] },
    ...values.names.map((row, position) => ({
      sql: 'INSERT INTO profile_names (id, profile_id, value, opinion, position) VALUES (?, ?, ?, ?, ?)',
      params: [newId(), profileId, row.value, row.opinion, position],
    })),
    ...values.pronouns.map((row, position) => ({
      sql: `INSERT INTO pronoun_sets
              (id, profile_id, subject, object, possessive_determiner,
               possessive_pronoun, reflexive, opinion, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId(), profileId, row.subject, row.object, row.possessiveDeterminer, row.possessivePronoun, row.reflexive, row.opinion, position],
    })),
    ...values.words.flatMap((group, position) => {
      const groupId = wordGroupIds[position];
      return [
        {
          sql: 'INSERT INTO profile_word_groups (id, profile_id, heading, position) VALUES (?, ?, ?, ?)',
          params: [groupId, profileId, group.heading, position],
        },
        ...group.words.map((word, wordPosition) => ({
          sql: 'INSERT INTO profile_words (id, group_id, value, opinion, position) VALUES (?, ?, ?, ?, ?)',
          params: [newId(), groupId, word.value, word.opinion, wordPosition],
        })),
      ];
    }),
    ...values.links.map((row, position) => ({
      sql: 'INSERT INTO profile_links (id, profile_id, label, url, position) VALUES (?, ?, ?, ?, ?)',
      params: [newId(), profileId, row.label, row.url, position],
    })),
    ...values.flags.map((row, position) => ({
      sql: 'INSERT INTO profile_identity_flags (id, profile_id, flag_key, opinion, position) VALUES (?, ?, ?, ?, ?)',
      params: [newId(), profileId, row.key, row.opinion, position],
    })),
    ...values.pronounPreferences.map((preference, position) => ({
      sql: 'INSERT INTO profile_pronoun_preferences (profile_id, preference_key, opinion, position) VALUES (?, ?, ?, ?)',
      params: [profileId, preference.key, preference.opinion, position],
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
  res.render('profile-edit', editorView(profile, await editorState(profile), {
    saved: req.query.saved === '1',
  }));
});
router.post('/profiles/:id/import/pronouns-page', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const current = await editorState(profile);
  const limit = await consume('profile_import', req.user.id);
  if (!limit.allowed) {
    return res.status(429).render('profile-edit', editorView(profile, current, {
      error: 'Too many import attempts. Try again later.',
    }));
  }
  try {
    const imported = await fetchPronounsPageProfile(req.body.pronouns_page_profile);
    const result = mapPronounsPageProfile(imported.payload, { locale: imported.locale, current });
    const omissions = [];
    if (result.skippedPronouns) omissions.push(`${result.skippedPronouns} pronoun set${result.skippedPronouns === 1 ? '' : 's'} that could not be expanded safely`);
    if (result.skippedCustomFlags) omissions.push(`${result.skippedCustomFlags} custom flag${result.skippedCustomFlags === 1 ? '' : 's'} whose artwork cannot be transferred`);
    if (result.skippedFlags) omissions.push(`${result.skippedFlags} unavailable built-in flag${result.skippedFlags === 1 ? '' : 's'}`);
    if (result.skippedWordGroups) omissions.push(`${result.skippedWordGroups} empty or unnamed word group${result.skippedWordGroups === 1 ? '' : 's'}`);
    const suffix = omissions.length ? ` Skipped ${omissions.join(' and ')}.` : '';
    return res.render('profile-edit', editorView(profile, result.values, {
      importNotice: `Imported the ${result.locale} profile for review.${suffix} Save the profile to keep these changes.`,
    }));
  } catch (error) {
    return res.status(400).render('profile-edit', editorView(profile, current, { error: error.message }));
  }
});
router.post('/profiles/:id/edit', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  let values;
  try {
    values = validateProfileForm(req.body);
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('profile-edit', editorView(profile, formValues(req.body), { error: error.message }));
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
    return res.status(422).render('profile-edit', editorView(profile, await editorState(profile), {
      warning: 'That edit matched a prohibited-content rule and was reverted. Do not submit it again. You may request Administrator review if the flag is incorrect.',
    }));
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
