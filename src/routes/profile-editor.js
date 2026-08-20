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
import { fullMarkdownAllowed, staffRoleLabel } from '../middleware/staff.js';
import { hasMarkdownLink, markdownLinkUrls } from '../markdown.js';
import { PRONOUN_PREFERENCES } from '../pronoun-preferences.js';
import { PRONOUN_PRESETS } from '../pronoun-presets.js';
import { DEFAULT_OPINION, isOpinion, normalizeOpinion, OPINIONS } from '../opinions.js';
import { groupProfileWords, PROFILE_WORD_GROUPS_SQL, PROFILE_WORDS_SQL } from '../profile-words.js';
import { avatarUrl, profileAvatarUrl, validateAvatarDataUri, MAX_AVATAR_DATA_URI_BYTES } from '../avatar.js';
import {
  additionalProfileStatements,
  deleteProfileStatements,
  heldUsernames,
  ownedProfileCount,
  releaseHoldStatements,
  releaseOldestHoldStatements,
  profileLimitFor,
  unlimitedProfiles,
  usernameAvailability,
  USERNAME_HOLD_MS,
} from '../profiles.js';
import {
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
const PROSE_MAX = 2000;
const DEFAULT_MARKDOWN = Object.freeze({ full: false, max: PROSE_MAX });
export function markdownSettings(staffRole) {
  return Object.freeze({ full: fullMarkdownAllowed(staffRole), max: PROSE_MAX });
}
const PRONOUN_FORM_FIELDS = ['subject', 'object', 'possessiveDeterminer', 'possessivePronoun', 'reflexive'];
const FLAG_OPTIONS = Object.freeze(PRONOUNS_PAGE_FLAG_OPTIONS.map((key) => Object.freeze({
  key,
  label: flagLabel(key),
  imageUrl: pronounsPageFlagUrl(key),
})));
async function editorView(profile, values, user, overrides = {}) {
  return {
    canDelete: Number(profile.is_primary) !== 1 && (await ownedProfileCount(user.id)) > 1,
    isPrimary: Number(profile.is_primary) === 1,
    isStaff: staffRoleLabel(user.staff_role) !== null,
    staffBadgeHidden: Number(profile.staff_badge_hidden) === 1,
    staffBadgeLabel: staffRoleLabel(user.staff_role),
    usernameHoldDays: Math.round(USERNAME_HOLD_MS / 86400000),
    title: `Edit ${profile.username}`,
    profile,
    values,
    ...avatarView(profile, user),
    error: null,
    warning: null,
    saved: false,
    importNotice: null,
    markdown: DEFAULT_MARKDOWN,
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
  return V.markdownText(String(value), options);
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
    flags: arrayField(body, 'profile_flag', 'profile_flag').map(String),
    words: wordGroupValues(body),
    pronounPreferences: PRONOUN_PREFERENCES
      .map((preference) => ({
        key: preference.key,
        opinion: selectedOpinion(body[`pronoun_pref_${preference.key}`]),
      }))
      .filter((preference) => preference.opinion !== null),
  };
}
export function validateProfileForm(body, { full = false, max = PROSE_MAX } = {}) {
  const raw = formValues(body);
  if (!full) {
    for (const [field, value] of [['About me', raw.description], ['Identity notes', raw.notes]]) {
      if (hasMarkdownLink(value)) {
        throw new V.ValidationError(`${field} does not accept hyperlinks. Add links in the Links section instead.`);
      }
    }
  }
  const values = {
    displayName: V.displayText(raw.displayName, { field: 'Display name', max: 80 }),
    description: optionalProse(raw.description, { field: 'About me', max }),
    notes: optionalProse(raw.notes, { field: 'Identity notes', max }),
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
  for (const rawFlag of raw.flags) {
    const flag = rawFlag.trim();
    if (!flag) continue;
    if (!PRONOUNS_PAGE_FLAG_OPTIONS.includes(flag)) throw new V.ValidationError('Choose a flag from the available Pronouns.page flags.');
    values.flags.push(flag);
  }
  return values;
}
async function editableProfile(profileId, userId) {
  const { rows } = await db.query(
    `SELECT p.id, p.username_display AS username, p.display_name, p.description, p.notes, p.published,
            p.is_primary, p.staff_badge_hidden, p.avatar_source, p.avatar_data_uri
       FROM profiles p
      WHERE p.id = ? AND p.owner_user_id = ?`,
    [profileId, userId],
  );
  return rows[0] || null;
}
function avatarView(profile, user) {
  return {
    avatar: profileAvatarUrl(profile, user),
    avatarSource: profile.avatar_source || 'inherit',
    accountAvatar: avatarUrl(user),
    identiconAvatar: avatarUrl({ id: profile.id, avatar_source: 'identicon' }),
    gravatarAvatar: avatarUrl({ ...user, avatar_source: 'gravatar', avatar_data_uri: null }),
    libravatarAvatar: avatarUrl({ ...user, avatar_source: 'libravatar', avatar_data_uri: null }),
    maxAvatarBytes: MAX_AVATAR_DATA_URI_BYTES,
  };
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
    db.query('SELECT flag_key FROM profile_identity_flags WHERE profile_id = ? ORDER BY position', [profile.id]),
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
    flags: flags.rows.length ? flags.rows.map((row) => row.flag_key) : [''],
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
    urls: {
      links: values.links.map((row) => row.url),
      description_links: markdownLinkUrls(values.description || ''),
      notes_links: markdownLinkUrls(values.notes || ''),
    },
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
            WHERE p.owner_user_id = ?
              AND EXISTS (SELECT 1 FROM content_suspensions WHERE id = ?)
            ON CONFLICT (suspension_id, profile_id) DO NOTHING`,
      params: [suspensionId, userId, suspensionId],
    },
    {
      sql: `UPDATE profiles SET published = 0, updated_at = ?
            WHERE owner_user_id = ?
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
    ...values.flags.map((flag, position) => ({
      sql: 'INSERT INTO profile_identity_flags (id, profile_id, flag_key, position) VALUES (?, ?, ?, ?)',
      params: [newId(), profileId, flag, position],
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
function newProfileView(overrides = {}) {
  return {
    title: 'New profile',
    error: null,
    held: [],
    values: { username: '', displayName: '' },
    ...overrides,
  };
}
router.get('/profiles/new', requireApproved, async (req, res) => {
  const limit = profileLimitFor(req.user);
  const owned = await ownedProfileCount(req.user.id);
  res.render('profile-new', newProfileView({
    limit, owned, atLimit: owned >= limit, held: await heldUsernames(req.user.id),
  }));
});
router.post('/profiles/new', requireApproved, async (req, res) => {
  const limit = profileLimitFor(req.user);
  const owned = await ownedProfileCount(req.user.id);
  const held = await heldUsernames(req.user.id);
  const view = (overrides) => newProfileView({ limit, owned, atLimit: owned >= limit, held, ...overrides });
  if (owned >= limit) {
    return res.status(409).render('profile-new', view({
      error: `This account already has its limit of ${limit} profile${limit === 1 ? '' : 's'}.`,
    }));
  }
  const rate = unlimitedProfiles(req.user) ? { allowed: true } : await consume('profile_create', req.user.id);
  if (!rate.allowed) {
    return res.status(429).render('profile-new', view({ error: 'Too many profiles created. Try again later.' }));
  }
  let username;
  let displayName;
  try {
    username = V.username(String(req.body.username ?? ''), { field: 'Username' });
    displayName = lineText(String(req.body.display_name ?? ''), { field: 'Display name', max: 80 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('profile-new', view({
      error: error.message,
      values: { username: String(req.body.username ?? ''), displayName: String(req.body.display_name ?? '') },
    }));
  }
  const now = Date.now();
  const availability = await usernameAvailability(username.key, { userId: req.user.id, now });
  if (!availability.available) {
    return res.status(409).render('profile-new', view({
      error: availability.reason,
      values: { username: username.display, displayName },
    }));
  }
  const rules = await loadCurrentRules();
  const screened = screenContent({ text: { display_name: displayName, names: [username.display] }, urls: {} }, rules);
  const filtered = await filterExemptMatches(screened, { userId: req.user.id, profileId: null });
  if (filtered.matches.some((match) => match.mode === 'enforcing')) {
    return res.status(422).render('profile-new', view({
      error: 'That username or display name matched a prohibited-content rule.',
      values: { username: username.display, displayName },
    }));
  }
  const created = additionalProfileStatements({
    userId: req.user.id,
    username: username.key,
    usernameDisplay: username.display,
    displayName,
    now,
  });
  await db.batch(created.statements);
  await audit.record({
    type: 'profile.created',
    actorUserId: req.user.id,
    subjectUserId: req.user.id,
    target: created.profileId,
    detail: { username: username.key, reclaimedOwnHold: Boolean(availability.ownHold) },
  });
  res.redirect(`/profiles/${created.profileId}/edit`);
});
router.post('/profiles/:id/delete', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  if (String(req.body.confirmation || '').trim() !== String(profile.username)) {
    return res.status(400).render('error', {
      title: 'Profile kept', status: 400,
      message: `Type ${profile.username} exactly, matching its capitalisation, to confirm removing that profile.`,
    });
  }
  if (Number(profile.is_primary) === 1) {
    return res.status(409).render('error', {
      title: 'Profile kept', status: 409,
      message: 'The primary profile of an account cannot be deleted. Delete the account itself to remove it.',
    });
  }
  const owned = await ownedProfileCount(req.user.id);
  if (owned <= 1) {
    return res.status(409).render('error', {
      title: 'Profile kept', status: 409,
      message: 'This is the only profile on the account. Delete the account itself to remove it.',
    });
  }
  const rate = unlimitedProfiles(req.user) ? { allowed: true } : await consume('profile_delete', req.user.id);
  if (!rate.allowed) {
    return res.status(429).render('error', {
      title: 'Profile kept', status: 429,
      message: 'Too many profiles deleted today. Try again later.',
    });
  }
  const { rows } = await db.query('SELECT username, username_display FROM profiles WHERE id = ?', [profile.id]);
  const stored = rows[0];
  if (!stored) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const now = Date.now();
  await db.batch([
    ...(await releaseOldestHoldStatements(req.user, now)),
    ...deleteProfileStatements({
      profileId: profile.id,
      username: stored.username,
      usernameDisplay: stored.username_display,
      userId: req.user.id,
      now,
    }),
  ]);
  await audit.record({
    type: 'profile.deleted',
    actorUserId: req.user.id,
    subjectUserId: req.user.id,
    target: profile.id,
    detail: { username: stored.username, heldUntil: now + USERNAME_HOLD_MS },
  });
  res.redirect('/dashboard');
});
router.get('/profiles/:id/edit', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  res.render('profile-edit', await editorView(profile, await editorState(profile), req.user, {
    saved: req.query.saved === '1',
    markdown: markdownSettings(req.user.staff_role),
  }));
});
router.post('/profiles/:id/avatar', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const source = String(req.body.avatar_source || '');
  if (!['inherit', 'gravatar', 'libravatar', 'identicon', 'data'].includes(source)) {
    return res.status(400).render('error', { title: 'Icon unchanged', status: 400, message: 'Choose a valid profile icon source.' });
  }
  let dataUri = null;
  if (source === 'data') {
    try {
      dataUri = validateAvatarDataUri(req.body.avatar_data_uri);
    } catch (error) {
      return res.status(400).render('error', { title: 'Icon unchanged', status: 400, message: error.message });
    }
  }
  await db.query(
    'UPDATE profiles SET avatar_source = ?, avatar_data_uri = ?, updated_at = ? WHERE id = ?',
    [source === 'inherit' ? null : source, dataUri, Date.now(), profile.id],
  );
  await audit.record({
    type: 'profile.avatar_changed', actorUserId: req.user.id, subjectUserId: req.user.id,
    target: profile.id, detail: { source },
  });
  res.redirect(`/profiles/${profile.id}/edit?saved=1#profile-icon`);
});
router.post('/profiles/holds/release', requireApproved, async (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const statements = await releaseHoldStatements({ userId: req.user.id, username });
  if (!statements) {
    return res.status(404).render('error', {
      title: 'Hold kept', status: 404, message: 'That username is not held by this account.',
    });
  }
  await db.batch(statements);
  await audit.record({
    type: 'profile.username_hold_released', actorUserId: req.user.id, subjectUserId: req.user.id,
    target: username, detail: { username },
  });
  res.redirect('/profiles/new');
});
router.post('/profiles/:id/staff-badge', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  if (!staffRoleLabel(req.user.staff_role)) {
    return res.status(403).render('error', { title: 'Badge unchanged', status: 403, message: 'Only staff carry a badge.' });
  }
  const hidden = req.body.staff_badge_hidden === 'on' ? 1 : 0;
  await db.query('UPDATE profiles SET staff_badge_hidden = ?, updated_at = ? WHERE id = ?', [hidden, Date.now(), profile.id]);
  await audit.record({
    type: 'profile.staff_badge_visibility', actorUserId: req.user.id, subjectUserId: req.user.id,
    target: profile.id, detail: { hidden: hidden === 1 },
  });
  res.redirect(`/profiles/${profile.id}/edit?saved=1#staff-badge`);
});
router.post('/profiles/:id/import/pronouns-page', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const current = await editorState(profile);
  const limit = await consume('profile_import', req.user.id);
  if (!limit.allowed) {
    return res.status(429).render('profile-edit', await editorView(profile, current, req.user, {
      error: 'Too many import attempts. Try again later.',
      markdown: markdownSettings(req.user.staff_role),
    }));
  }
  try {
    const imported = await fetchPronounsPageProfile(req.body.pronouns_page_profile);
    const result = mapPronounsPageProfile(imported.payload, { locale: imported.locale, current });
    const omissions = [];
    if (result.skippedPronouns) omissions.push(`${result.skippedPronouns} pronoun set${result.skippedPronouns === 1 ? '' : 's'} that could not be expanded safely`);
    if (result.skippedCustomFlags) omissions.push(`${result.skippedCustomFlags} custom flag${result.skippedCustomFlags === 1 ? '' : 's'} whose artwork cannot be transferred`);
    if (result.skippedFlags) omissions.push(`${result.skippedFlags} unavailable built-in flag${result.skippedFlags === 1 ? '' : 's'}`);
    if (result.skippedWordGroups) omissions.push(`${result.skippedWordGroups} empty word group${result.skippedWordGroups === 1 ? '' : 's'}`);
    const suffix = omissions.length ? ` Skipped ${omissions.join(' and ')}.` : '';
    return res.render('profile-edit', await editorView(profile, result.values, req.user, {
      importNotice: `Imported the ${result.locale} profile for review.${suffix} Save the profile to keep these changes.`,
      markdown: markdownSettings(req.user.staff_role),
    }));
  } catch (error) {
    return res.status(400).render('profile-edit', await editorView(profile, current, req.user, {
      error: error.message,
      markdown: markdownSettings(req.user.staff_role),
    }));
  }
});
router.post('/profiles/:id/edit', requireApproved, async (req, res) => {
  const profile = await editableProfile(req.params.id, req.user.id);
  if (!profile) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const markdown = markdownSettings(req.user.staff_role);
  let values;
  try {
    values = validateProfileForm(req.body, markdown);
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('profile-edit', await editorView(profile, formValues(req.body), req.user, {
      error: error.message,
      markdown,
    }));
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
    return res.status(422).render('profile-edit', await editorView(profile, await editorState(profile), req.user, {
      markdown,
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
