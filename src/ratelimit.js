const MIN = 60 * 1000;
const HOUR = 60 * MIN;
export const POLICIES = {
  signup: { max: 5, window: HOUR },
  login_ip: { max: 10, window: 15 * MIN },
  login_account: { max: 10, window: 15 * MIN },
  password_reset_ip: { max: 5, window: HOUR },
  password_reset_account: { max: 3, window: HOUR },
  reauth: { max: 10, window: 15 * MIN },
  consent: { max: 20, window: HOUR },
  invite_accept_ip: { max: 10, window: HOUR },
  invite_send_workspace: { max: 20, window: 24 * HOUR },
  export_request: { max: 5, window: 24 * HOUR },
  profile_import: { max: 10, window: HOUR },
  altcha_challenge: { max: 120, window: HOUR },
};
const counters = new Map();
function sweep(now) {
  for (const [key, entry] of counters) {
    if (now >= entry.expiresAt) counters.delete(key);
  }
}
export async function consume(policyName, subject, { now = Date.now() } = {}) {
  const policy = POLICIES[policyName];
  if (!policy) throw new Error(`Unknown rate-limit policy: ${policyName}`);
  const key = `${policyName}:${subject}`;
  let entry = counters.get(key);
  if (!entry || now >= entry.expiresAt) {
    entry = { count: 0, expiresAt: now + policy.window };
    counters.set(key, entry);
  }
  entry.count += 1;
  if (counters.size > 1024) sweep(now);
  return { allowed: entry.count <= policy.max, count: entry.count, limit: policy.max, resetAt: entry.expiresAt };
}
export async function peek(policyName, subject, { now = Date.now() } = {}) {
  const policy = POLICIES[policyName];
  const key = `${policyName}:${subject}`;
  const entry = counters.get(key);
  const count = entry && now < entry.expiresAt ? entry.count : 0;
  return { count, limit: policy.max, remaining: Math.max(0, policy.max - count) };
}
export function _reset() {
  counters.clear();
}
