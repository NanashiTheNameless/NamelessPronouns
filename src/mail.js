import config from './config.js';
import logger from './logger.js';
const ENDPOINT = 'https://api.resend.com/emails';
const ANTIPHISH = 'A staff will never ask you for the code and never share it.';
export const outbox = [];
const BUCKET_CAPACITY = 10;
const REFILL_MS = 60 * 1000;
const buckets = new Map();
const queue = [];
function takeToken(recipient, now = Date.now()) {
  const key = String(recipient).toLowerCase();
  const b = buckets.get(key) || { tokens: BUCKET_CAPACITY, last: now };
  const refill = Math.floor((now - b.last) / REFILL_MS);
  if (refill > 0) {
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + refill);
    b.last += refill * REFILL_MS;
  }
  const ok = b.tokens > 0;
  if (ok) b.tokens -= 1;
  if (b.tokens >= BUCKET_CAPACITY) buckets.delete(key);
  else buckets.set(key, b);
  return ok;
}
function sweepBuckets(now = Date.now()) {
  for (const [key, b] of buckets) {
    const refill = Math.floor((now - b.last) / REFILL_MS);
    if (refill > 0) {
      b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + refill);
      b.last += refill * REFILL_MS;
    }
    if (b.tokens >= BUCKET_CAPACITY) buckets.delete(key);
  }
}
export async function drainMailQueue({ now = Date.now() } = {}) {
  let sent = 0;
  for (let i = 0; i < queue.length; ) {
    if (takeToken(queue[i].to, now)) {
      const [msg] = queue.splice(i, 1);
      await deliver(msg);
      sent++;
    } else {
      i++;
    }
  }
  sweepBuckets(now);
  return { sent, pending: queue.length };
}
export function queueDepth() {
  return queue.length;
}
export function _resetMailState() {
  buckets.clear();
  queue.length = 0;
}
export function _bucketCount() {
  return buckets.size;
}
export function scheduleMailDrain() {
  const handle = setInterval(() => {
    drainMailQueue().catch((err) =>
      logger.error('mail drain failed', { error: err.message }),
    );
  }, 15 * 1000);
  handle.unref?.();
  return handle;
}
export async function sendEmail({ to, subject, text, idempotencyKey, critical = false }) {
  text = `${text}\n\n${ANTIPHISH}`;
  if (critical || takeToken(to)) return deliver({ to, subject, text, idempotencyKey });
  queue.push({ to, subject, text, idempotencyKey });
  return { id: 'queued' };
}
async function deliver({ to, subject, text, idempotencyKey }) {
  const body = { from: config.RESEND_FROM, to: [to], subject, text };
  if (config.NODE_ENV === 'test') {
    outbox.push({ to, subject, text });
    return { id: 'test-outbox' };
  }
  if (!config.isProd && process.env.MAIL_DEV_LOG === 'true') {
    logger.info('dev mail (not sent)', { to, subject });
    return { id: 'dev-log' };
  }
  let attempt = 0;
  const maxAttempts = 3;
  while (true) {
    attempt++;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`transient ${res.status}`);
      if (!res.ok) {
        logger.error('mail send failed', { status: res.status });
        return { id: null, error: true };
      }
      const json = await res.json().catch(() => ({}));
      return { id: json.id || null };
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger.error('mail send exhausted retries', { error: err.message });
        return { id: null, error: true };
      }
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }
}
export function verificationEmail(to, link, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Verify your email',
    text: `Confirm your email address to finish setting up your account:\n\n${link}\n\nThis link expires in 10 minutes. If you did not request this, ignore this message.`,
    idempotencyKey,
    critical: true,
  });
}
export function emailChangeVerification(to, link, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Confirm your new email address',
    text: `Confirm this address for your account:\n\n${link}\n\nThe link expires in one hour and can be used once. If you did not request this, ignore it and the account remains unchanged.`,
    idempotencyKey,
    critical: true,
  });
}
export function recoveryLink(to, link, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Administrative account recovery approved',
    text: `An Administrator approved a time-limited account recovery:\n\n${link}\n\nThe link expires in 30 minutes and can be used once. It resets the password, removes authenticator 2FA and recovery codes, and signs out every session. If you did not expect this, do not use the link and contact support.`,
    idempotencyKey,
    critical: true,
  });
}
export function twofaEmail(to, code, link, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Your sign-in code',
    text: `Your sign-in code is: ${code}\n\nOr open this link in the same browser where you started signing in:\n${link}\n\nThe code and link expire in 10 minutes and can be used once.`,
    idempotencyKey,
    critical: true,
  });
}
export function reauthEmail(to, code, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Confirm a sensitive change',
    text: `Your confirmation code is: ${code}\n\nEnter it to authorize a security-sensitive change to your account. The code expires in 10 minutes and can be used once. If you did not start this, ignore this message and your account is unchanged.`,
    idempotencyKey,
    critical: true,
  });
}
export function passwordResetEmail(to, link, emailCode, secondCode, idempotencyKey) {
  const second = secondCode
    ? `\n\nYour separate email two-factor code is: ${secondCode}`
    : '\n\nAlso enter a current authenticator code or an unused recovery code.';
  return sendEmail({
    to,
    subject: 'Reset your account password',
    text: `Open this reset page:\n\n${link}\n\nYour email verification code is: ${emailCode}${second}\n\nThe link and codes expire in 10 minutes and can be used once. A successful reset signs out every existing session. If you did not request this, ignore this message and your password remains unchanged.`,
    idempotencyKey,
    critical: true,
  });
}
export function dataExportLink(to, link, idempotencyKey) {
  return sendEmail({
    to,
    subject: 'Your account data export',
    text: `Download your account data:\n\n${link}\n\nThe browser must first accept the Terms and Privacy Policy and attest that the visitor is at least 18. This link is available for 14 days before its first use. After the first download, it remains available for 7 more days. If you did not request it, ignore this message.`,
    idempotencyKey,
    critical: true,
  });
}
export function securityNotice(to, summary) {
  return sendEmail({
    to,
    subject: 'Security notice',
    text: `A security-relevant change occurred on your account:\n\n${summary}\n\nTime: ${new Date().toISOString()}\n\nIf this was not you, contact support.`,
  });
}
export function decisionEmail(to) {
  return sendEmail({
    to,
    subject: 'Update on your account request',
    text: 'There is an update on your account request. Sign in for details.',
  });
}
export function contentWarning(to, categories) {
  const categoryText = categories.join(' ');
  return sendEmail({
    to,
    subject: 'Profile edit reverted',
    text: `A profile edit was reverted because it matched a prohibited-content rule.\n\nAffected categories: ${categoryText}\n\nDo not submit it again. If the flag is incorrect, sign in and request Administrator review. This email does not include the attempted content.`,
  });
}
export function contentReviewDecision(to, outcome) {
  const summaries = {
    upheld: 'An Administrator upheld a content flag.',
    cleared: 'An Administrator cleared a content flag.',
    exempted: 'An Administrator cleared a content flag and created a narrow exemption.',
  };
  if (!summaries[outcome]) throw new Error(`Unknown content review outcome: ${outcome}`);
  return sendEmail({
    to,
    subject: 'Content flag review completed',
    text: `${summaries[outcome]} Sign in to view the status.`,
  });
}
const ADMIN_ACTIONS = Object.freeze({
  pending_signup: {
    subject: 'Admin action needed: account request',
    summary: 'A new account request is waiting for approval or denial.',
  },
  content_flag: {
    subject: 'Admin action needed: content flag',
    summary: 'An enforcing profile content flag is waiting for Administrator review.',
  },
  content_suspension: {
    subject: 'Admin action needed: content suspension',
    summary: 'An automatic content suspension is waiting for Administrator review.',
  },
  recovery_case: {
    subject: 'Admin action needed: recovery case',
    summary: 'An administrative account-recovery case is waiting for review.',
  },
});
export function adminActionNeeded(action, idempotencyKey) {
  const template = ADMIN_ACTIONS[action];
  if (!template) throw new Error(`Unknown administrative action notification: ${action}`);
  return sendEmail({
    to: config.ADMIN_NOTIFY_TO,
    subject: template.subject,
    text: `${template.summary}\n\nOpen the authenticated administration area:\n${config.BASE_URL}/admin`,
    idempotencyKey,
  });
}
