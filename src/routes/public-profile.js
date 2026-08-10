import express from 'express';
import db from '../db/index.js';
import { publicPageHeaders } from '../middleware/security-headers.js';
import { matchViewingBan } from '../bans.js';
import { clientIp } from '../util/net.js';
import * as V from '../validation.js';
import { avatarUrl } from '../avatar.js';
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
            u.id AS owner_id, u.email AS owner_email, u.avatar_source, u.avatar_data_uri
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
  const [names, pronouns, links] = await Promise.all([
    db.query('SELECT value FROM profile_names WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT subject, object, possessive_determiner, possessive_pronoun, reflexive FROM pronoun_sets WHERE profile_id = ? ORDER BY position', [profile.id]),
    db.query('SELECT label, url FROM profile_links WHERE profile_id = ? ORDER BY position', [profile.id]),
  ]);
  res.render('profile', {
    title: `${profile.display_name} (@${profile.username_display})`,
    username: profile.username_display,
    profile,
    avatar: avatarUrl({ id: profile.owner_id, email: profile.owner_email, avatar_source: profile.avatar_source, avatar_data_uri: profile.avatar_data_uri }),
    names: names.rows,
    pronouns: pronouns.rows,
    links: links.rows,
  });
});
export default router;
