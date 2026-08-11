import express from 'express';
import db from '../db/index.js';
import { allowProfileContent, publicPageHeaders } from '../middleware/security-headers.js';
import { matchViewingBan } from '../bans.js';
import { clientIp } from '../util/net.js';
import * as V from '../validation.js';
import { avatarUrl } from '../avatar.js';
import { flagLabel, pronounsPageFlagUrl } from '../pronouns-page-import.js';
import { pronounPreferenceLabel } from '../pronoun-preferences.js';
import { opinionView } from '../opinions.js';
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
  someone: {
    displayName: 'Someone',
    bio: 'Someone was definitely here. Witnesses disagree about nearly every other detail.\n\n**Status:** identified in principle.',
    notes: '- Someone wrote this note.\n- Please direct follow-up questions to somebody else.',
    names: [{ value: 'Someone', opinion: 'yes' }, { value: 'A Person', opinion: 'okay' }],
    pronouns: [{ short: 'some/one', opinion: 'jokingly' }, { short: 'they/them', opinion: 'yes' }],
    words: [{ heading: 'I am', words: [{ value: 'here', opinion: 'yes' }, { value: 'nobody', opinion: 'nope' }] }],
  },
  something: {
    displayName: 'Something',
    bio: 'The claim that this site contains Nothing is now formally disputed.\n\n**Status:** demonstrably not nothing.',
    notes: '- Something had to be done. This is it.\n- Everything considers this profile incomplete.',
    names: [{ value: 'Something', opinion: 'yes' }, { value: 'A Thing', opinion: 'jokingly' }],
    pronouns: [{ short: 'some/thing', opinion: 'jokingly' }, { short: 'it/its', opinion: 'yes' }],
    words: [{ heading: 'I am', words: [{ value: 'substantial', opinion: 'close' }, { value: 'nothing', opinion: 'nope' }] }],
  },
  unknown: {
    displayName: 'Unknown',
    bio: 'This profile is complete. Its identity remains under investigation.\n\n**Status:** insufficient information, excellent documentation.',
    notes: '- Known unknowns are listed above.\n- Unknown unknowns declined to comment.',
    names: [{ value: 'Unknown', opinion: 'yes' }, { value: 'To Be Determined', opinion: 'jokingly' }],
    pronouns: [{ short: 'who/knows', opinion: 'jokingly' }, { short: 'they/them', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'documented', opinion: 'yes' }, { value: 'identified', opinion: 'nope' }] }],
  },
  else: {
    displayName: 'Else',
    bio: 'Every prior condition evaluated to false, so here I am.\n\n**Status:** the remaining possibility.',
    notes: '- I follow if.\n- Otherwise, this section would be empty.',
    names: [{ value: 'Else', opinion: 'yes' }, { value: 'Otherwise', opinion: 'jokingly' }],
    pronouns: [{ short: 'other/wise', opinion: 'jokingly' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'conditional', opinion: 'yes' }, { value: 'the first choice', opinion: 'nope' }] }],
  },
  everyone: {
    displayName: 'Everyone',
    bio: 'Yes, this includes you.\n\nPlease form an orderly plural.',
    notes: '- Everyone agrees with this note.\n- Nobody was available for comment.',
    names: [{ value: 'Everyone', opinion: 'yes' }, { value: 'All of you', opinion: 'okay' }],
    pronouns: [{ short: 'they/them', opinion: 'yes' }, { short: 'we/us', opinion: 'okay' }, { short: 'you/all', opinion: 'jokingly' }],
    words: [{ heading: 'We are', words: [{ value: 'legion', opinion: 'nope' }, { value: 'all here', opinion: 'yes' }] }],
  },
  everything: {
    displayName: 'Everything',
    bio: 'I contain every possible profile field, including several that have not been invented yet.\n\n**Status:** all of the above.',
    notes: '- Everything is a lot. Please be specific.\n- Nothing has filed a formal objection.',
    names: [{ value: 'Everything', opinion: 'yes' }, { value: 'All of It', opinion: 'jokingly' }],
    pronouns: [{ short: 'all/all', opinion: 'jokingly' }, { short: 'they/them', opinion: 'yes' }],
    words: [{ heading: 'I am', words: [{ value: 'included', opinion: 'yes' }, { value: 'excluded', opinion: 'nope' }] }],
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
  nothing: {
    displayName: 'Nothing',
    bio: 'Nothing has a profile now. This has complicated several definitions.\n\n**Status:** conspicuously absent.',
    notes: '- Nothing to add.\n- That previous note may have been something.',
    names: [{ value: 'Nothing', opinion: 'yes' }, { value: 'Not Anything', opinion: 'jokingly' }],
    pronouns: [{ short: 'no/thing', opinion: 'jokingly' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'absent', opinion: 'yes' }, { value: 'present', opinion: 'nope' }] }],
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
  root: {
    displayName: 'Root',
    bio: 'I have access to everything except a normal conversation.\n\n**Status:** operating with unnecessary privileges.',
    notes: '- Pronoun changes require elevated permissions.\n- Please do not run me in production.\n- The Owner denies granting this account access.',
    names: [{ value: 'Root', opinion: 'yes' }, { value: 'Superuser', opinion: 'jokingly' }],
    pronouns: [{ short: 'sudo/sudo', opinion: 'jokingly' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'privileged', opinion: 'yes' }, { value: 'a shell', opinion: 'nope' }] }],
  },
  void: {
    displayName: 'Void',
    bio: 'There is nothing to see here, and it would like to be seen clearly.\n\n**Status:** containing multitudes of nothing.',
    notes: '- The Void has excellent boundaries.\n- Please leave emptiness as you found it.',
    names: [{ value: 'Void', opinion: 'yes' }, { value: 'The Abyss', opinion: 'jokingly' }],
    pronouns: [{ short: 'void/void', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'empty', opinion: 'close' }, { value: 'a database value', opinion: 'nope' }] }],
  },
  staff: {
    displayName: 'Staff',
    bio: 'A collective noun wearing a badge.\n\n**Status:** on shift, technically.',
    notes: '- Staff is several people and one shared inbox.\n- The individual members are elsewhere, being people.',
    names: [{ value: 'Staff', opinion: 'yes' }, { value: 'The Team', opinion: 'okay' }],
    pronouns: [{ short: 'they/them', opinion: 'yes' }, { short: 'we/us', opinion: 'jokingly' }],
    words: [{ heading: 'We are', words: [{ value: 'on duty', opinion: 'yes' }, { value: 'one person', opinion: 'nope' }] }],
  },
  owner: {
    displayName: 'Owner',
    bio: 'The role that keeps the lights on. The person holding it is somewhere else, being a person.\n\n**Status:** probably debugging.',
    notes: '- This is the job, not the human.\n- The human wrote this bit and then denied it.',
    names: [{ value: 'Owner', opinion: 'yes' }, { value: 'The Management', opinion: 'jokingly' }],
    pronouns: [{ short: 'they/them', opinion: 'yes' }, { short: 'it/its', opinion: 'okay' }],
    words: [{ heading: 'I am', words: [{ value: 'responsible', opinion: 'yes' }, { value: 'available', opinion: 'nope' }] }],
  },
  infinity: {
    displayName: 'Infinity',
    bio: 'I started introducing myself once. I am not finished yet.\n\n**Status:** continuing indefinitely.',
    notes: '- There is always room for one more note.\n- This profile ends for accessibility reasons.',
    names: [{ value: 'Infinity', opinion: 'yes' }, { value: 'Forever', opinion: 'jokingly' }],
    pronouns: [{ short: 'on/and/on', opinion: 'jokingly' }, { short: 'they/them', opinion: 'yes' }],
    words: [{ heading: 'I am', words: [{ value: 'endless', opinion: 'yes' }, { value: 'finished', opinion: 'nope' }] }],
  },
});
function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
}
export function pronounOpinionEgg(opinions) {
  const keys = opinions.filter(Boolean);
  if (keys.length < 2) return null;
  if (keys.every((key) => key === 'nope')) return 'A confident no. Respected.';
  if (keys.every((key) => key === 'jokingly')) return 'Nothing here is serious. Including this line.';
  return null;
}
function teapotAdjacent(res, pairs) {
  if (pairs.some((pair) => pair.toLowerCase() === 'it/its')) res.setHeader('X-Teapot-Adjacent', 'yes');
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
  teapotAdjacent(res, placeholder.pronouns.map((row) => row.short));
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
    names: placeholder.names.map((row) => ({ ...row, opinion: opinionView(row.opinion) })),
    pronouns: placeholder.pronouns.map((row) => ({ ...row, opinion: opinionView(row.opinion) })),
    pronounOpinionEgg: pronounOpinionEgg(placeholder.pronouns.map((row) => row.opinion)),
    words: placeholder.words.map((group) => ({
      ...group,
      words: group.words.map((row) => ({ ...row, opinion: opinionView(row.opinion) })),
    })),
    links: [],
    flags: [],
    pronounPreferences: [],
  });
}
export const staticProfileRouter = express.Router();
const TITLE_ONLY_USERNAMES = new Set(['admin', 'administrator', 'moderator', 'support']);
const OWNER_USERNAME = 'NamelessNanashi';
export const EGG_USERNAMES = new Set([
  ...Object.keys(PLACEHOLDER_PROFILES),
  ...TITLE_ONLY_USERNAMES,
  '404', 'nanashi', 'me', 'self',
]);
staticProfileRouter.use(publicPageHeaders);
staticProfileRouter.get(['/user/:username', '/@:username'], (req, res, next) => {
  const requested = String(req.params.username || '').toLowerCase();
  if (!EGG_USERNAMES.has(requested)) return next();
  noStore(res);
  return res.redirect(301, `/u/${requested}`);
});
staticProfileRouter.get('/u/:username', async (req, res, next) => {
  const requested = String(req.params.username || '').toLowerCase();
  if (requested === '404') {
    noStore(res);
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Recursion detected.' });
  }
  if (requested === 'nanashi') {
    noStore(res);
    return res.redirect(302, `/u/${OWNER_USERNAME}`);
  }
  if (TITLE_ONLY_USERNAMES.has(requested)) {
    noStore(res);
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Titles are not people.' });
  }
  if (!Object.hasOwn(PLACEHOLDER_PROFILES, requested)) return next();
  noStore(res);
  if (req.params.username !== requested) return res.redirect(301, `/u/${requested}`);
  return placeholderProfile(res, requested);
});
router.use(publicPageHeaders);
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
router.get('/u/self', async (req, res) => {
  noStore(res);
  if (!req.user) {
    return res.status(404).render('error', { title: 'Self not found', status: 404, message: 'Self not found.' });
  }
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
  teapotAdjacent(res, pronouns.rows.map((row) => `${row.subject}/${row.object}`));
  if (profile.staff_role === 'owner') res.setHeader('X-Owner-Status', 'probably-debugging');
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
    names: names.rows.map((row) => ({ value: row.value, opinion: opinionView(row.opinion) })),
    pronouns: pronouns.rows.map((row) => ({ ...row, opinion: opinionView(row.opinion) })),
    pronounOpinionEgg: pronounOpinionEgg(pronouns.rows.map((row) => row.opinion)),
    words: groupProfileWords(wordGroups.rows, words.rows).map((group) => ({
      heading: group.heading,
      words: group.words.map((word) => ({ value: word.value, opinion: opinionView(word.opinion) })),
    })),
    links: links.rows,
    flags: flags.rows.map((row) => ({
      key: row.flag_key,
      label: flagLabel(row.flag_key),
      imageUrl: pronounsPageFlagUrl(row.flag_key),
    })),
    pronounPreferences: pronounPreferences.rows.map((row) => ({
      label: pronounPreferenceLabel(row.preference_key),
      opinion: opinionView(row.opinion),
    })),
  });
});
export default router;
