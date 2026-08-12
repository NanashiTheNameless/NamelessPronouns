import express from 'express';
import db from '../db/index.js';
import audit from '../audit.js';
import { requireStaff } from '../middleware/staff.js';
import { requireFreshAuth } from '../middleware/session.js';
import { compileRule, compileSeed, ContentRuleError, ruleMatches } from '../content-rules.js';
import * as V from '../validation.js';
import { newId } from '../util/ids.js';
import { ipPrefixHash } from '../util/net.js';
import * as mail from '../mail.js';
import { keyedHash, safeEqual } from '../util/crypto.js';
import { normalizeExemptionValue } from '../content-exemptions.js';
import { CONTENT_FIELD_LABELS } from '../content-fields.js';
const router = express.Router();
const SHADOW_MS = 7 * 24 * 60 * 60 * 1000;
const TYPES = ['exact_field', 'whole_token', 'exact_phrase', 'host', 'host_suffix', 'exact_url', 'url_prefix'];
const SEVERITIES = ['info', 'warning', 'critical'];
const MODES = ['disabled', 'shadow', 'enforcing'];
const PREVIEW_MS = 10 * 60 * 1000;
function issuePreviewProof(userId, kind, payload) {
  const expires = Date.now() + PREVIEW_MS;
  return `${expires}.${keyedHash(`content-rule-preview:v1:${userId}:${kind}:${expires}:${JSON.stringify(payload)}`)}`;
}
function validPreviewProof(proof, userId, kind, payload) {
  if (typeof proof !== 'string') return false;
  const [expiresText, digest, extra] = proof.split('.');
  const expires = Number(expiresText);
  if (extra !== undefined || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + PREVIEW_MS) return false;
  const expected = keyedHash(`content-rule-preview:v1:${userId}:${kind}:${expires}:${JSON.stringify(payload)}`);
  return safeEqual(digest, expected);
}
function formInput(body = {}, existing = null) {
  return {
    id: existing?.rule_id || String(body.id || ''),
    type: String(body.type || existing?.rule_type || 'whole_token'),
    match: String(body.match || existing?.match_value || ''),
    category: String(body.category || existing?.category || ''),
    severity: String(body.severity || existing?.severity || 'warning'),
    mode: String(body.mode || existing?.mode || 'shadow'),
    explanation: String(body.explanation || existing?.explanation || ''),
    shouldMatch: String(body.should_match || ''),
    shouldNotMatch: String(body.should_not_match || ''),
    urgent: body.urgent === 'on',
    reason: String(body.reason || ''),
  };
}
function corpus(value) {
  const lines = value.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 50 || lines.some((line) => line.length > 2048)) throw new ContentRuleError('Test corpus is too large.');
  return lines;
}
function validateCandidate(input) {
  const rule = compileRule(input);
  const kind = ['host', 'host_suffix', 'exact_url', 'url_prefix'].includes(rule.type) ? 'url' : 'text';
  const shouldMatch = corpus(input.shouldMatch);
  const shouldNotMatch = corpus(input.shouldNotMatch);
  if (shouldMatch.length === 0 || shouldNotMatch.length === 0) {
    throw new ContentRuleError('Provide at least one matching and one non-matching test case.');
  }
  const failedMatch = shouldMatch.filter((value) => !ruleMatches(rule, value, kind));
  const failedNonMatch = shouldNotMatch.filter((value) => ruleMatches(rule, value, kind));
  if (failedMatch.length || failedNonMatch.length) throw new ContentRuleError('The candidate failed its test corpus.');
  return { rule, shouldMatch, shouldNotMatch };
}
function renderForm(res, { input, existing = null, preview = null, previewProof = null, error = null, status = 200 }) {
  return res.status(status).render('admin/content-rule-form', {
    title: existing ? 'Create content rule version' : 'Create content rule',
    input, existing, preview, previewProof, error, types: TYPES, severities: SEVERITIES, modes: MODES,
  });
}
router.get('/admin/content-rules', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, v.version, v.rule_type, v.category, v.severity, v.mode, v.enforce_at, v.created_at
       FROM content_rules r JOIN content_rule_versions v ON v.id = r.current_version_id
      ORDER BY r.id`,
  );
  res.render('admin/content-rules', {
    title: 'Content rules',
    rules: rows.map((row) => ({
      ...row,
      effectiveMode: row.mode === 'shadow' && row.enforce_at && Number(row.enforce_at) <= Date.now() ? 'enforcing' : row.mode,
      enforceAt: row.enforce_at ? new Date(Number(row.enforce_at)).toISOString() : null,
    })),
  });
});
router.get('/admin/content-exemptions', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.rule_version_id, e.field_type, e.user_id, e.profile_id, e.self_exemption,
            e.normalized_value, e.normalized_value_hash, e.expires_at, e.created_at,
            e.updated_at, v.rule_id, v.version, u.email
       FROM content_rule_exemptions e
       LEFT JOIN content_rule_versions v ON v.id = e.rule_version_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.revoked_at IS NULL
      ORDER BY e.created_at DESC`,
  );
  res.render('admin/content-exemptions', {
    title: 'Content exemptions',
    exemptions: rows.map((row) => ({
      ...row,
      legacyHashed: row.normalized_value === null && row.normalized_value_hash !== null,
      accountWide: row.rule_version_id === null && row.field_type === null && row.normalized_value === null
        && row.normalized_value_hash === null,
      expiresAt: row.expires_at ? new Date(Number(row.expires_at)).toISOString() : null,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: row.updated_at ? new Date(Number(row.updated_at)).toISOString() : null,
    })),
  });
});
const EXEMPTION_TYPES = ['term', 'account'];
const EXEMPTION_EXPIRIES = ['none', '7', '30', '90'];
function exemptionInput(body = {}, existing = null) {
  const existingType = existing && existing.normalized_value === null && existing.normalized_value_hash === null
    ? 'account' : 'term';
  return {
    type: String(body.type ?? (existing ? existingType : 'term')),
    accountScope: String(body.account_scope ?? (existing ? 'keep' : 'user')),
    email: String(body.email || ''),
    profileId: String(body.profile_id ?? existing?.profile_id ?? ''),
    ruleId: String(body.rule_id ?? existing?.rule_id ?? ''),
    fieldType: String(body.field_type ?? existing?.field_type ?? ''),
    value: String(body.value ?? existing?.normalized_value ?? ''),
    expiry: String(body.expiry ?? (existing ? 'keep' : 'none')),
    reason: String(body.reason ?? ''),
  };
}
function exemptionValue(input) {
  const value = V.proseText(input, { field: 'Exempt value', max: 2048 });
  if (value.includes('\n')) throw new V.ValidationError('Exempt value must be a single line.');
  return value;
}
async function resolveExemption(input, existing = null) {
  if (!EXEMPTION_TYPES.includes(input.type)) throw new V.ValidationError('Choose a valid exemption type.');
  const reason = V.displayText(input.reason, { field: 'Exemption reason', max: 200 });
  let userId = existing ? existing.user_id : null;
  if (input.accountScope === 'all') userId = null;
  else if (input.accountScope === 'user') {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new V.ValidationError('Account email is required for an account-scoped exemption.');
    const { rows } = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (!rows[0]) throw new V.ValidationError('No account matches that email.');
    userId = rows[0].id;
  } else if (input.accountScope !== 'keep' || !existing) {
    throw new V.ValidationError('Choose a valid account scope.');
  }
  if (input.type === 'account' && !userId) {
    throw new V.ValidationError('An account-wide exemption must name one account.');
  }
  let profileId = null;
  if (input.type === 'term' && input.profileId.trim()) {
    if (!userId) throw new V.ValidationError('A profile-scoped exemption must name one account.');
    profileId = input.profileId.trim();
    const { rows } = await db.query(
      `SELECT p.id FROM profiles p JOIN workspaces w ON w.id = p.workspace_id
        WHERE p.id = ? AND w.owner_user_id = ?`,
      [profileId, userId],
    );
    if (!rows[0]) throw new V.ValidationError('That profile does not belong to that account.');
  }
  let ruleVersionId = null;
  let fieldType = null;
  let value = null;
  if (input.type === 'term') {
    if (input.ruleId.trim()) {
      const { rows } = await db.query('SELECT current_version_id FROM content_rules WHERE id = ?', [input.ruleId.trim()]);
      if (!rows[0]) throw new V.ValidationError('No content rule matches that ID.');
      ruleVersionId = rows[0].current_version_id;
    }
    if (input.fieldType.trim()) {
      if (!Object.hasOwn(CONTENT_FIELD_LABELS, input.fieldType.trim())) {
        throw new V.ValidationError('Choose a valid field.');
      }
      fieldType = input.fieldType.trim();
    }
    value = normalizeExemptionValue(fieldType, exemptionValue(input.value));
  }
  const allowedExpiries = existing ? [...EXEMPTION_EXPIRIES, 'keep'] : EXEMPTION_EXPIRIES;
  if (!allowedExpiries.includes(input.expiry)) throw new V.ValidationError('Choose a valid expiry.');
  const now = Date.now();
  let expiresAt = null;
  if (input.expiry === 'keep') expiresAt = existing.expires_at === null ? null : Number(existing.expires_at);
  else if (input.expiry !== 'none') expiresAt = now + Number(input.expiry) * 24 * 60 * 60 * 1000;
  return { reason, userId, profileId, ruleVersionId, fieldType, value, expiresAt, now };
}
async function renderExemptionForm(res, { input, existing = null, error = null, status = 200 }) {
  const { rows } = await db.query(
    `SELECT r.id, v.version FROM content_rules r
       JOIN content_rule_versions v ON v.id = r.current_version_id ORDER BY r.id`,
  );
  return res.status(status).render('admin/content-exemption-form', {
    title: existing ? 'Edit content exemption' : 'Create content exemption',
    input, existing, error, rules: rows, fields: Object.entries(CONTENT_FIELD_LABELS),
    expiries: EXEMPTION_EXPIRIES,
  });
}
async function findExemption(id) {
  const { rows } = await db.query(
    `SELECT e.id, e.rule_version_id, e.field_type, e.normalized_value, e.normalized_value_hash,
            e.user_id, e.profile_id, e.self_exemption, e.expires_at, e.created_at, v.rule_id, v.version, u.email
       FROM content_rule_exemptions e
       LEFT JOIN content_rule_versions v ON v.id = e.rule_version_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = ? AND e.revoked_at IS NULL`,
    [id],
  );
  return rows[0] || null;
}
function exemptionAuditDetail(resolved, input) {
  return {
    type: input.type,
    scope: resolved.userId ? (resolved.profileId ? 'profile' : 'account') : 'all accounts',
    ruleVersionId: resolved.ruleVersionId || 'all rules',
    field: resolved.fieldType || 'all fields',
    expires: resolved.expiresAt === null ? 'never' : new Date(resolved.expiresAt).toISOString(),
    reason: resolved.reason,
  };
}
async function notifyExemptionChange(userId, message) {
  if (!userId) return;
  const { rows } = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
  if (rows[0]?.email) mail.securityNotice(rows[0].email, message).catch(() => {});
}
router.get('/admin/content-exemptions/new', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const input = exemptionInput({});
  if (typeof req.query.email === 'string') input.email = req.query.email;
  await renderExemptionForm(res, { input });
});
router.post(
  '/admin/content-exemptions/new',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-exemptions/new' }),
  async (req, res) => {
    const input = exemptionInput(req.body);
    let resolved;
    try {
      resolved = await resolveExemption(input);
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return renderExemptionForm(res, { input, error: error.message, status: 400 });
    }
    if (req.body.confirmation !== 'CREATE EXEMPTION') {
      return renderExemptionForm(res, { input, error: 'Type CREATE EXEMPTION exactly to continue.', status: 400 });
    }
    const id = newId();
    await db.query(
      `INSERT INTO content_rule_exemptions
         (id, rule_version_id, field_type, normalized_value, user_id, profile_id,
          reason, created_by, self_exemption, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, resolved.ruleVersionId, resolved.fieldType, resolved.value, resolved.userId,
        resolved.profileId, resolved.reason, req.user.id, resolved.expiresAt, resolved.now],
    );
    await audit.record({
      type: 'content_rule.exemption_created', actorUserId: req.user.id, subjectUserId: resolved.userId,
      target: id, ipHash: ipPrefixHash(req), detail: exemptionAuditDetail(resolved, input),
    });
    await notifyExemptionChange(resolved.userId, input.type === 'account'
      ? 'A content-rule exemption covering your whole account was created by staff.'
      : 'A content-rule exemption was created on your account by staff.');
    res.redirect('/admin/content-exemptions');
  },
);
router.get('/admin/content-exemptions/:id/edit', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const existing = await findExemption(req.params.id);
  if (!existing) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  await renderExemptionForm(res, { input: exemptionInput({}, existing), existing });
});
router.post(
  '/admin/content-exemptions/:id/edit',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-exemptions' }),
  async (req, res) => {
    const existing = await findExemption(req.params.id);
    if (!existing) return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That exemption is no longer active.' });
    const input = exemptionInput(req.body, existing);
    let resolved;
    try {
      resolved = await resolveExemption(input, existing);
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return renderExemptionForm(res, { input, existing, error: error.message, status: 400 });
    }
    if (req.body.confirmation !== 'UPDATE EXEMPTION') {
      return renderExemptionForm(res, { input, existing, error: 'Type UPDATE EXEMPTION exactly to continue.', status: 400 });
    }
    const { rowCount } = await db.query(
      `UPDATE content_rule_exemptions
          SET rule_version_id = ?, field_type = ?, normalized_value = ?, normalized_value_hash = NULL,
              user_id = ?, profile_id = ?, reason = ?, expires_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND revoked_at IS NULL`,
      [resolved.ruleVersionId, resolved.fieldType, resolved.value, resolved.userId, resolved.profileId,
        resolved.reason, resolved.expiresAt, resolved.now, req.user.id, existing.id],
    );
    if (!rowCount) {
      return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That exemption is no longer active.' });
    }
    await audit.record({
      type: 'content_rule.exemption_updated', actorUserId: req.user.id, subjectUserId: resolved.userId,
      target: existing.id, ipHash: ipPrefixHash(req), detail: exemptionAuditDetail(resolved, input),
    });
    await notifyExemptionChange(existing.user_id, 'A content-rule exemption on your account was changed by staff.');
    if (resolved.userId && resolved.userId !== existing.user_id) {
      await notifyExemptionChange(resolved.userId, 'A content-rule exemption was moved onto your account by staff.');
    }
    res.redirect('/admin/content-exemptions');
  },
);
router.post(
  '/admin/content-exemptions/:id',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-exemptions' }),
  async (req, res) => {
    const action = String(req.body.action || '');
    const phrase = action === 'revoke' ? 'REVOKE EXEMPTION' : 'UPDATE EXEMPTION';
    if (!['revoke', 'expiry'].includes(action) || req.body.confirmation !== phrase) {
      return res.status(400).render('error', { title: 'Confirmation required', status: 400, message: `Type ${phrase} exactly to continue.` });
    }
    let reason;
    try {
      reason = V.displayText(req.body.reason, { field: 'Change reason', max: 200 });
    } catch (error) {
      if (!(error instanceof V.ValidationError)) throw error;
      return res.status(400).render('error', { title: 'Invalid change', status: 400, message: error.message });
    }
    const { rows } = await db.query(
      `SELECT e.id, e.user_id, e.self_exemption, u.email
         FROM content_rule_exemptions e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id = ? AND e.revoked_at IS NULL`,
      [req.params.id],
    );
    const exemption = rows[0];
    if (!exemption) return res.status(409).render('error', { title: 'Unavailable', status: 409, message: 'That exemption is no longer active.' });
    const now = Date.now();
    let expiresAt = null;
    if (action === 'expiry') {
      const expiry = String(req.body.expiry || '');
      if (!['none', '7', '30', '90'].includes(expiry)) {
        return res.status(400).render('error', { title: 'Invalid change', status: 400, message: 'Choose a valid expiry.' });
      }
      expiresAt = expiry === 'none' ? null : now + Number(expiry) * 24 * 60 * 60 * 1000;
      await db.query('UPDATE content_rule_exemptions SET expires_at = ? WHERE id = ? AND revoked_at IS NULL', [expiresAt, exemption.id]);
    } else {
      await db.query(
        'UPDATE content_rule_exemptions SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL',
        [now, req.user.id, reason, exemption.id],
      );
    }
    await audit.record({
      type: action === 'revoke' ? 'content_rule.exemption_revoked' : 'content_rule.exemption_expiry_updated',
      actorUserId: req.user.id, subjectUserId: exemption.user_id, target: exemption.id, ipHash: ipPrefixHash(req),
      detail: { reason, expires: action === 'expiry' ? (expiresAt ? new Date(expiresAt).toISOString() : 'never') : undefined },
    });
    if (exemption.email) {
      mail.securityNotice(exemption.email, action === 'revoke'
        ? 'A content-rule exemption on your account was revoked.'
        : 'The expiry of a content-rule exemption on your account was changed.').catch(() => {});
    }
    res.redirect('/admin/content-exemptions');
  },
);
router.get('/admin/content-rules/new', requireStaff('administrator'), requireFreshAuth(), (req, res) => {
  renderForm(res, { input: formInput() });
});
router.get('/admin/content-rules/import', requireStaff('administrator'), requireFreshAuth(), (req, res) => {
  res.render('admin/content-rule-import', { title: 'Import content rules', source: '', reason: '', preview: null, previewProof: null, error: null });
});
router.post(
  '/admin/content-rules/import',
  requireStaff('administrator'),
  requireFreshAuth({ returnTo: '/admin/content-rules/import' }),
  async (req, res) => {
    const source = String(req.body.source || '');
    let reason;
    let parsed;
    let rules;
    try {
      reason = V.displayText(req.body.reason, { field: 'Import reason', max: 200 });
      parsed = JSON.parse(source);
      if (!Array.isArray(parsed?.rules) || parsed.rules.length === 0 || parsed.rules.length > 100) {
        throw new ContentRuleError('Import must contain between 1 and 100 rules.');
      }
      for (const item of parsed.rules) {
        if (!Array.isArray(item.tests?.shouldMatch) || item.tests.shouldMatch.length === 0
          || !Array.isArray(item.tests?.shouldNotMatch) || item.tests.shouldNotMatch.length === 0) {
          throw new ContentRuleError('Every imported rule needs matching and non-matching regression tests.');
        }
        if (item.explanation) item.explanation = V.proseText(item.explanation, { field: 'Rule explanation', max: 1000 });
      }
      rules = compileSeed(parsed);
      for (const rule of rules) {
        const found = await db.query('SELECT id FROM content_rules WHERE id = ?', [rule.id]);
        if (found.rows.length) throw new ContentRuleError(`Rule ID ${rule.id} already exists; imports create new rules only.`);
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof ContentRuleError) && !(error instanceof V.ValidationError)) throw error;
      return res.status(400).render('admin/content-rule-import', {
        title: 'Import content rules', source, reason: String(req.body.reason || ''), preview: null, previewProof: null,
        error: error instanceof SyntaxError ? 'Import JSON is invalid.' : error.message,
      });
    }
    if (req.body.action === 'preview') {
      return res.render('admin/content-rule-import', {
        title: 'Import content rules', source, reason, preview: rules,
        previewProof: issuePreviewProof(req.user.id, 'import', { source, reason }), error: null,
      });
    }
    if (req.body.action !== 'save' || req.body.confirmation !== 'IMPORT RULES'
      || !validPreviewProof(req.body.preview_proof, req.user.id, 'import', { source, reason })) {
      return res.status(400).render('admin/content-rule-import', {
        title: 'Import content rules', source, reason, preview: rules, previewProof: null,
        error: 'Preview first, then type IMPORT RULES exactly.',
      });
    }
    const now = Date.now();
    const statements = [];
    for (const rule of rules) {
      const versionId = newId();
      const storedMode = rule.mode === 'enforcing' ? 'shadow' : rule.mode;
      const enforceAt = rule.mode === 'enforcing' ? now + SHADOW_MS : null;
      statements.push(
        { sql: 'INSERT INTO content_rules (id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?)', params: [rule.id, versionId, now, now] },
        {
          sql: `INSERT INTO content_rule_versions
                  (id, rule_id, version, rule_type, match_value, category, severity, mode,
                   enforce_at, explanation, created_by, created_at)
                VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [versionId, rule.id, rule.type, rule.matchValue, rule.category, rule.severity,
            storedMode, enforceAt, rule.explanation || null, req.user.id, now],
        },
      );
    }
    await db.batch(statements);
    await Promise.all(rules.map((rule) => audit.record({
      type: 'content_rule.imported', actorUserId: req.user.id, target: rule.id, ipHash: ipPrefixHash(req),
      detail: { scheduledEnforcement: rule.mode === 'enforcing', reason },
    })));
    res.redirect('/admin/content-rules');
  },
);
router.get('/admin/content-rules/:id/edit', requireStaff('administrator'), requireFreshAuth(), async (req, res) => {
  const { rows } = await db.query(
    `SELECT v.rule_id, v.version, v.rule_type, v.match_value, v.category, v.severity, v.mode, v.explanation
       FROM content_rules r JOIN content_rule_versions v ON v.id = r.current_version_id
      WHERE r.id = ?`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
  renderForm(res, { input: formInput({}, rows[0]), existing: rows[0] });
});
async function handleMutation(req, res, existingId = null) {
  let existing = null;
  if (existingId) {
    const result = await db.query('SELECT id FROM content_rules WHERE id = ?', [existingId]);
    if (!result.rows[0]) return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' });
    existing = { rule_id: existingId };
  }
  const input = formInput(req.body, existing);
  let candidate;
  try {
    input.reason = V.displayText(input.reason, { field: 'Change reason', max: 200 });
    if (input.explanation) input.explanation = V.proseText(input.explanation, { field: 'Internal explanation', max: 1000 });
    candidate = validateCandidate(input);
  } catch (error) {
    if (!(error instanceof ContentRuleError) && !(error instanceof V.ValidationError)) throw error;
    return renderForm(res, { input, existing, error: error.message, status: 400 });
  }
  if (req.body.action === 'preview') {
    return renderForm(res, {
      input, existing, preview: candidate,
      previewProof: issuePreviewProof(req.user.id, existingId || 'new', input),
    });
  }
  const confirmation = existingId ? 'CREATE VERSION' : 'CREATE RULE';
  if (req.body.action !== 'save' || req.body.confirmation !== confirmation
    || !validPreviewProof(req.body.preview_proof, req.user.id, existingId || 'new', input)) {
    return renderForm(res, { input, existing, preview: candidate, error: `Preview first, then type ${confirmation} exactly.`, status: 400 });
  }
  if (!existingId && input.id !== candidate.rule.id) {
    return renderForm(res, { input, existing, preview: candidate, error: 'Rule ID changed during validation.', status: 400 });
  }
  const now = Date.now();
  const urgent = input.mode === 'enforcing' && input.urgent;
  const storedMode = input.mode === 'enforcing' && !urgent ? 'shadow' : input.mode;
  const enforceAt = input.mode === 'enforcing' && !urgent ? now + SHADOW_MS : null;
  const versionId = newId();
  if (existingId) {
    await db.batch([
      { sql: 'UPDATE content_rules SET updated_at = updated_at WHERE id = ?', params: [existingId] },
      {
        sql: `INSERT INTO content_rule_versions
                (id, rule_id, version, rule_type, match_value, category, severity, mode,
                 enforce_at, explanation, created_by, created_at)
              SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM content_rule_versions WHERE rule_id = ?`,
        params: [versionId, existingId, candidate.rule.type, candidate.rule.matchValue, candidate.rule.category,
          candidate.rule.severity, storedMode, enforceAt, candidate.rule.explanation || null, req.user.id, now, existingId],
      },
      { sql: 'UPDATE content_rules SET current_version_id = ?, updated_at = ? WHERE id = ?', params: [versionId, now, existingId] },
    ]);
  } else {
    const found = await db.query('SELECT id FROM content_rules WHERE id = ?', [candidate.rule.id]);
    if (found.rows.length) return renderForm(res, { input, existing, preview: candidate, error: 'That rule ID already exists.', status: 409 });
    await db.batch([
      { sql: 'INSERT INTO content_rules (id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?)', params: [candidate.rule.id, versionId, now, now] },
      {
        sql: `INSERT INTO content_rule_versions
                (id, rule_id, version, rule_type, match_value, category, severity, mode,
                 enforce_at, explanation, created_by, created_at)
              VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [versionId, candidate.rule.id, candidate.rule.type, candidate.rule.matchValue,
          candidate.rule.category, candidate.rule.severity, storedMode, enforceAt,
          candidate.rule.explanation || null, req.user.id, now],
      },
    ]);
  }
  await audit.record({
    type: existingId ? 'content_rule.version_created' : 'content_rule.created',
    actorUserId: req.user.id, target: candidate.rule.id, ipHash: ipPrefixHash(req),
    detail: { mode: storedMode, scheduledEnforcement: Boolean(enforceAt), urgentActivation: urgent, reason: input.reason },
  });
  res.redirect('/admin/content-rules');
}
router.post('/admin/content-rules/new', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/content-rules/new' }), (req, res) => handleMutation(req, res));
router.post('/admin/content-rules/:id/edit', requireStaff('administrator'), requireFreshAuth({ returnTo: '/admin/content-rules' }), (req, res) => handleMutation(req, res, req.params.id));
export default router;
