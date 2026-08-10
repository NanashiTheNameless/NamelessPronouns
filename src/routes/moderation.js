import express from 'express';
import db from '../db/index.js';
import audit from '../audit.js';
import * as mail from '../mail.js';
import * as V from '../validation.js';
import { requireAuth } from '../middleware/session.js';
import { newId } from '../util/ids.js';
import { ipPrefixHash } from '../util/net.js';
const router = express.Router();
function requireReviewAccess(req, res, next) {
  if (req.user?.signup_status !== 'approved') {
    return res.status(403).render('error', { title: 'Unavailable', status: 403, message: 'Content review is unavailable.' });
  }
  next();
}
router.get('/account/content-flags', requireAuth, requireReviewAccess, async (req, res) => {
  const { rows } = await db.query(
    `SELECT f.id, f.policy_category, f.severity, f.field_type, f.status,
            f.created_at, r.status AS review_status, r.requested_at
       FROM content_flags f
       LEFT JOIN content_flag_reviews r ON r.flag_id = f.id
      WHERE f.user_id = ? AND f.mode = 'enforcing'
      ORDER BY f.created_at DESC`,
    [req.user.id],
  );
  res.render('account/content-flags', {
    title: 'Content flags',
    flags: rows.map((row) => ({
      ...row,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    })),
    error: null,
  });
});
router.post('/account/content-flags/:id/review', requireAuth, requireReviewAccess, async (req, res) => {
  let explanation;
  try {
    explanation = V.displayText(req.body.explanation, { field: 'Review explanation', max: 500 });
  } catch (error) {
    if (!(error instanceof V.ValidationError)) throw error;
    return res.status(400).render('error', { title: 'Invalid request', status: 400, message: error.message });
  }
  const { rows } = await db.query(
    `SELECT f.id FROM content_flags f
       LEFT JOIN content_flag_reviews r ON r.flag_id = f.id
      WHERE f.id = ? AND f.user_id = ? AND f.mode = 'enforcing'
        AND f.status = 'pending' AND r.id IS NULL`,
    [req.params.id, req.user.id],
  );
  if (!rows[0]) {
    return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That flag is not available for review.' });
  }
  const reviewId = newId();
  const now = Date.now();
  try {
    await db.query(
      `INSERT INTO content_flag_reviews
         (id, flag_id, requested_by, explanation, requested_at)
       VALUES (?, ?, ?, ?, ?)`,
      [reviewId, rows[0].id, req.user.id, explanation, now],
    );
  } catch {
    return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That flag already has a review request.' });
  }
  await audit.record({
    type: 'content_flag.review_requested', actorUserId: req.user.id,
    subjectUserId: req.user.id, target: rows[0].id, ipHash: ipPrefixHash(req),
  });
  mail.adminActionNeeded('content_flag', `content-review:${reviewId}`).catch(() => {});
  res.redirect('/account/content-flags');
});
export default router;
