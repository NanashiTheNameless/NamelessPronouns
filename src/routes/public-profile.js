import express from 'express';
import db from '../db/index.js';
import { allowProfileContent, publicPageHeaders } from '../middleware/security-headers.js';
import { matchViewingBan } from '../bans.js';
import { clientIp } from '../util/net.js';
import * as V from '../validation.js';
import { avatarUrl } from '../avatar.js';
import { flagLabel, pronounsPageFlagUrl } from '../pronouns-page-import.js';
import { pronounPreferenceLabel } from '../pronoun-preferences.js';
import { opinionLabel } from '../opinions.js';
import { fullMarkdownAllowed, roleAtLeast, staffRoleDescription, staffRoleLabel } from '../middleware/staff.js';
import { renderProfileMarkdown } from '../markdown.js';
import { collectCodeUsage, collectEmbeddedOrigins, withScriptNonce } from '../html-sanitize.js';
import { obfuscateEmails } from '../email-obfuscation.js';
import { groupProfileWords, PROFILE_WORD_GROUPS_SQL, PROFILE_WORDS_SQL } from '../profile-words.js';
const router = express.Router();
export const PLACEHOLDER_PROFILES = Object.freeze({
  null: {
    displayName: 'Null',
    bio: 'No value was provided, so I brought my own.\n\n**Status:** intentionally empty.',
    notes: '- Please do not compare me loosely.\n- I have boundaries.',
    names: [{ value: 'Null', opinion: 'yes' }, { value: 'Nothing', opinion: 'jokingly' }],
    pronouns: [{ short: 'null/null', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am a', words: [{ value: 'placeholder', opinion: 'yes' }, { value: 'database value', opinion: 'nope' }] }],
  },
  undefined: {
    displayName: 'Undefined',
    bio: 'Nobody assigned me a value. I showed up anyway.\n\n**Status:** still loading. Probably.',
    notes: '- Expected: something.\n- Actual: vibes.\n- Check the caller before blaming the callee.',
    names: [{ value: 'Undefined', opinion: 'yes' }, { value: 'Pending', opinion: 'jokingly' }],
    pronouns: [{ short: 'not/set', opinion: 'jokingly' }, { short: 'they/them', opinion: 'okay' }],
    words: [{ heading: 'I am a', words: [{ value: 'work in progress', opinion: 'yes' }, { value: 'runtime error', opinion: 'close' }] }],
  },
  anonymous: {
    displayName: 'Anonymous',
    bio: 'I would tell you who I am, but that would rather defeat the point.\n\n**Status:** redacted by me.',
    notes: '- This profile was written by someone. Allegedly.\n- Citation needed.',
    names: [{ value: 'Anonymous', opinion: 'yes' }, { value: 'Someone', opinion: 'close' }],
    pronouns: [{ short: 'they/them', opinion: 'yes' }, { short: 'who/whom', opinion: 'jokingly' }],
    words: [{ heading: 'I am a', words: [{ value: 'person', opinion: 'okay' }, { value: 'reliable source', opinion: 'nope' }] }],
  },
  everyone: {
    displayName: 'Everyone',
    bio: 'Yes, this includes you.\n\nPlease form an orderly plural.',
    notes: '- Everyone agrees with this note.\n- Nobody was available for comment.',
    names: [{ value: 'Everyone', opinion: 'yes' }, { value: 'All of you', opinion: 'okay' }],
    pronouns: [{ short: 'they/them', opinion: 'yes' }, { short: 'we/us', opinion: 'okay' }, { short: 'you/all', opinion: 'jokingly' }],
    words: [{ heading: 'We are', words: [{ value: 'legion', opinion: 'nope' }, { value: 'all here', opinion: 'yes' }] }],
  },
  nobody: {
    displayName: 'Nobody',
    bio: 'Nobody was here. Nobody saw anything.\n\nThat is the story, and Nobody is sticking to it.',
    notes: '- Nobody asked. This is technically true.\n- If found, return to nowhere.',
    names: [{ value: 'Nobody', opinion: 'yes' }, { value: 'Who', opinion: 'jokingly' }],
    pronouns: [{ short: 'no/pronouns', opinion: 'nope' }, { short: 'who/whom', opinion: 'jokingly' }],
    pronounsHeader: 'none',
    words: [{ heading: 'I am', words: [{ value: 'here', opinion: 'nope' }, { value: 'missing', opinion: 'yes' }] }],
  },
  epoch: {
    displayName: 'Epoch',
    bio: 'I have been waiting since 1970-01-01T00:00:00Z.\n\nEverything was simpler when the timestamp was zero.',
    notes: '- I remember everything after zero.\n- Dates before me are someone else\'s timezone problem.',
    names: [{ value: 'Epoch', opinion: 'yes' }, { value: 'Zero', opinion: 'jokingly' }],
    pronouns: [{ short: 'time/time', opinion: 'yes' }, { short: 'then/now', opinion: 'jokingly' }],
    words: [{ heading: 'I am a', words: [{ value: 'timestamp', opinion: 'yes' }, { value: 'timeless', opinion: 'nope' }] }],
  },
  nan: {
    displayName: 'NaN',
    bio: 'Not a Name, but close enough for a profile URL.\n\n**Status:** mathematically questionable.',
    notes: '- Equality checks have been inconclusive.\n- Please do not ask me to become a number.',
    names: [{ value: 'NaN', opinion: 'yes' }, { value: 'Not a Name', opinion: 'jokingly' }],
    pronouns: [{ short: 'not/a/name', opinion: 'yes' }, { short: 'they/them', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'a number', opinion: 'nope' }, { value: 'confusing', opinion: 'yes' }] }],
  },
  localhost: {
    displayName: 'Localhost',
    bio: 'There is no place like `127.0.0.1`.\n\nVisitors are always from around here.',
    notes: '- Home is where the loopback is.\n- Remote relationships are complicated.',
    names: [{ value: 'Localhost', opinion: 'yes' }, { value: 'Home', opinion: 'close' }],
    pronouns: [{ short: 'here/here', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'local', opinion: 'yes' }, { value: 'remote', opinion: 'nope' }] }],
  },
  true: {
    displayName: 'True',
    bio: 'I agree with this profile.\n\nThis statement evaluates to itself.',
    notes: '- Everything is fine.\n- False strongly disagrees.',
    names: [{ value: 'True', opinion: 'yes' }, { value: 'Correct', opinion: 'jokingly' }],
    pronouns: [{ short: 'yes/yes', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'right', opinion: 'yes' }, { value: 'false', opinion: 'nope' }] }],
  },
  false: {
    displayName: 'False',
    bio: 'I disagree with this profile.\n\nThe previous sentence cannot be trusted.',
    notes: '- Nothing is fine.\n- True would say otherwise.',
    names: [{ value: 'False', opinion: 'yes' }, { value: 'Incorrect', opinion: 'jokingly' }],
    pronouns: [{ short: 'no/no', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'wrong', opinion: 'okay' }, { value: 'true', opinion: 'nope' }] }],
  },
});
router.use(publicPageHeaders);
function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
}
function previewReason(profile, user) {
  if (!user) return null;
  if (user.id === profile.owner_id) return 'owner';
  return roleAtLeast(user.staff_role, 'support') ? 'staff' : null;
}
function parseUsername(input) {
  try {
    return V.username(input);
  } catch {
    return null;
  }
}
async function placeholderProfile(res, username) {
  const placeholder = PLACEHOLDER_PROFILES[username];
  const profile = { id: 'placeholder', display_name: placeholder.displayName, description: '', notes: '' };
  res.setHeader('X-Pronouns', placeholder.pronounsHeader || placeholder.pronouns[0].short);
  return res.render('profile', {
    title: `${placeholder.displayName} (@${username})`,
    preview: null,
    descriptionHtml: await renderProfileMarkdown(placeholder.bio, { full: false }),
    notesHtml: await renderProfileMarkdown(placeholder.notes, { full: false, headingOffset: 1 }),
    username,
    profile,
    staffBadge: null,
    staffBadgeLine: null,
    ownerEgg: false,
    avatar: avatarUrl({ id: `placeholder:${username}` }),
    names: placeholder.names.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
    pronouns: placeholder.pronouns.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
    words: placeholder.words.map((group) => ({
      ...group,
      words: group.words.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
    })),
    links: [],
    flags: [],
    pronounPreferences: [],
  });
}
router.get(['/user/:username', '/@:username'], (req, res) => {
  noStore(res);
  const parsed = parseUsername(req.params.username);
  if (!parsed) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  res.redirect(301, `/u/${encodeURIComponent(parsed.display)}`);
});
router.get('/u/me', async (req, res) => {
  noStore(res);
  if (!req.user) return res.redirect('/login');
  const { rows } = await db.query(
    `SELECT p.username_display FROM profiles p
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE w.owner_user_id = ? ORDER BY p.created_at LIMIT 1`,
    [req.user.id],
  );
  if (!rows[0]) return res.redirect('/dashboard');
  return res.redirect(`/u/${encodeURIComponent(rows[0].username_display)}`);
});
router.get('/u/:username', async (req, res) => {
  noStore(res);
  const requested = String(req.params.username || '').toLowerCase();
  if (Object.hasOwn(PLACEHOLDER_PROFILES, requested)) {
    const ban = await matchViewingBan({ userId: req.user?.id, email: req.user?.email, ip: clientIp(req) });
    if (ban) return res.status(403).render('profile-unavailable', { title: 'Unavailable' });
    if (req.params.username !== requested) return res.redirect(301, `/u/${requested}`);
    return placeholderProfile(res, requested);
  }
  const parsed = parseUsername(req.params.username);
  if (!parsed) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  const ban = await matchViewingBan({ userId: req.user?.id, email: req.user?.email, ip: clientIp(req) });
  if (ban) {
    return res.status(403).render('profile-unavailable', { title: 'Unavailable' });
  }
  const { rows } = await db.query(
    `SELECT p.id, p.username_display, p.display_name, p.description, p.notes, p.theme,
            p.published,
            u.id AS owner_id, u.email AS owner_email, u.avatar_source, u.avatar_data_uri, u.staff_role
       FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
       JOIN users u ON u.id = w.owner_user_id
      WHERE p.username = ?`,
    [parsed.key],
  );
  const profile = rows[0];
  if (!profile) {
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  }
  const unpublished = Number(profile.published) !== 1;
  const preview = unpublished ? previewReason(profile, req.user) : null;
  if (unpublished && !preview) {
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  }
  if (req.params.username !== profile.username_display) {
    return res.redirect(301, `/u/${encodeURIComponent(profile.username_display)}`);
  }
  const [names, pronouns, links, flags, pronounPreferences, wordGroups, words] = await Promise.all([
    db.query('SELECT value, opinion FROM profile_names WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT subject, object, possessive_determiner, possessive_pronoun, reflexive, opinion FROM pronoun_sets WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT label, url FROM profile_links WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT flag_key FROM profile_identity_flags WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT preference_key, opinion FROM profile_pronoun_preferences WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query(PROFILE_WORD_GROUPS_SQL, [profile.id]),
    db.query(PROFILE_WORDS_SQL, [profile.id]),
  ]);
  const full = fullMarkdownAllowed(profile.staff_role);
  const markdown = (value, headingOffset) => renderProfileMarkdown(value, {
    full,
    headingOffset,
    inlineText: obfuscateEmails,
  });
  let descriptionHtml = profile.description ? await markdown(profile.description, 0) : '';
  let notesHtml = profile.notes ? await markdown(profile.notes, 1) : '';
  const authored = `${descriptionHtml}\n${notesHtml}`;
  const codeMode = allowProfileContent(
    res,
    collectEmbeddedOrigins(authored),
    full ? collectCodeUsage(authored) : null,
    { permitted: full },
  );
  if (codeMode === 'nonce') {
    descriptionHtml = withScriptNonce(descriptionHtml, res.locals.cspNonce);
    notesHtml = withScriptNonce(notesHtml, res.locals.cspNonce);
  }
  if (pronouns.rows[0]) {
    res.setHeader('X-Pronouns', `${pronouns.rows[0].subject}/${pronouns.rows[0].object}`);
  }
  res.render('profile', {
    title: `${profile.display_name} (@${profile.username_display})`,
    preview,
    descriptionHtml,
    notesHtml,
    username: profile.username_display,
    profile,
    staffBadge: staffRoleLabel(profile.staff_role),
    staffBadgeLine: staffRoleDescription(profile.staff_role),
    ownerEgg: profile.staff_role === 'owner',
    avatar: avatarUrl({ id: profile.owner_id, email: profile.owner_email, avatar_source: profile.avatar_source, avatar_data_uri: profile.avatar_data_uri }),
    names: names.rows.map((row) => ({ value: row.value, opinion: opinionLabel(row.opinion) })),
    pronouns: pronouns.rows.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
    words: groupProfileWords(wordGroups.rows, words.rows).map((group) => ({
      heading: group.heading,
      words: group.words.map((word) => ({ value: word.value, opinion: opinionLabel(word.opinion) })),
    })),
    links: links.rows,
    flags: flags.rows.map((row) => ({
      key: row.flag_key,
      label: flagLabel(row.flag_key),
      imageUrl: pronounsPageFlagUrl(row.flag_key),
    })),
    pronounPreferences: pronounPreferences.rows.map((row) => ({
      label: pronounPreferenceLabel(row.preference_key),
      opinion: opinionLabel(row.opinion),
    })),
  });
});
export default router;
