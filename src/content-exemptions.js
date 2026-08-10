import db from './db/index.js';
import { keyedHash } from './util/crypto.js';
export function normalizedExemptionHash(field, value) {
  let normalized = String(value).replace(/ {2,}/g, ' ').trim();
  if (field === 'links') {
    try {
      const url = new URL(normalized);
      url.hostname = url.hostname.toLowerCase();
      normalized = url.toString();
    } catch {
    }
  } else {
    normalized = normalized.toLowerCase();
  }
  return keyedHash(`content-exemption:v1:${field}:${normalized}`);
}
export async function matchingExemption(match, { userId, profileId, database = db, now = Date.now() }) {
  const { rows } = await database.query(
    `SELECT id FROM content_rule_exemptions
      WHERE rule_version_id = ? AND field_type = ? AND normalized_value_hash = ?
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
        AND (user_id IS NULL OR user_id = ?)
        AND (profile_id IS NULL OR profile_id = ?)
      LIMIT 1`,
    [
      match.ruleVersionId,
      match.field,
      normalizedExemptionHash(match.field, match.attemptedValue),
      now,
      userId,
      profileId,
    ],
  );
  return rows[0] || null;
}
export async function matchIsExempt(match, context) {
  return Boolean(await matchingExemption(match, context));
}
export async function filterExemptMatches(matches, context) {
  const exemptions = await Promise.all(matches.map((match) => matchingExemption(match, context)));
  return {
    matches: matches.filter((_, index) => !exemptions[index]),
    uses: exemptions.flatMap((exemption, index) => exemption ? [{ exemptionId: exemption.id, match: matches[index] }] : []),
  };
}
export async function removeExemptMatches(matches, context) {
  return (await filterExemptMatches(matches, context)).matches;
}
