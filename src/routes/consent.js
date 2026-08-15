import express from 'express';
import { buildAcceptance, recordAcceptance, setAcceptanceCookie } from '../policy.js';
import { consume } from '../ratelimit.js';
import { ipPrefixHash } from '../util/net.js';
import { publicPageHeaders } from '../middleware/security-headers.js';
import { clearConsentReturn, readConsentReturn, safeConsentReturn } from '../consent-return.js';
const router = express.Router();
router.use(publicPageHeaders);
router.get('/consent', (req, res) => {
  res.render('consent', {
    title: 'Before you continue',
    next: safeConsentReturn(req.query.next),
    error: null,
  });
});
router.post('/consent', async (req, res) => {
  const limit = await consume('consent', ipPrefixHash(req) || 'unknown');
  if (!limit.allowed) {
    return res.status(429).render('error', { title: 'Slow down', status: 429, message: 'Too many requests. Try again later.' });
  }
  const { policies, age18 } = req.body;
  const encryptedTarget = readConsentReturn(req);
  const target = encryptedTarget || safeConsentReturn(req.body.next);
  if (policies !== 'on' || age18 !== 'on') {
    return res.status(400).render('consent', {
      title: 'Before you continue',
      next: encryptedTarget ? '/' : target,
      error: 'You must agree to the policies and confirm that you are at least 18 years old.',
    });
  }
  clearConsentReturn(res);
  setAcceptanceCookie(res, buildAcceptance());
  if (req.user) await recordAcceptance({ userId: req.user.id, ipHash: ipPrefixHash(req) });
  res.redirect(target);
});
export default router;
