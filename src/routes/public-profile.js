import express from 'express';
import db from '../db/index.js';
import { publicPageHeaders } from '../middleware/security-headers.js';
import { matchViewingBan } from '../bans.js';
import { clientIp } from '../util/net.js';
import * as V from '../validation.js';
import { avatarUrl } from '../avatar.js';
import { flagLabel, pronounsPageFlagUrl } from '../pronouns-page-import.js';
import { pronounPreferenceLabel } from '../pronoun-preferences.js';
import { opinionLabel } from '../opinions.js';
import { staffRoleLabel } from '../middleware/staff.js';
import { groupProfileWords, PROFILE_WORD_GROUPS_SQL, PROFILE_WORDS_SQL } from '../profile-words.js';
const router = express.Router();
router.use(publicPageHeaders);
function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
}
function parseUsername(input) {
  try {
    return V.username(input);
  } catch {
    return null;
  }
}
router.get(['/user/:username', '/@:username'], (req, res) => {
  noStore(res);
  const parsed = parseUsername(req.params.username);
  if (!parsed) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  res.redirect(301, `/u/${encodeURIComponent(parsed.display)}`);
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
            u.id AS owner_id, u.email AS owner_email, u.avatar_source, u.avatar_data_uri, u.staff_role
       FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
       JOIN users u ON u.id = w.owner_user_id
      WHERE p.username = ? AND p.published = 1`,
    [parsed.key],
  );
  const profile = rows[0];
  if (!profile) {
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
  res.render('profile', {
    title: `${profile.display_name} (@${profile.username_display})`,
    username: profile.username_display,
    profile,
    staffBadge: staffRoleLabel(profile.staff_role),
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
