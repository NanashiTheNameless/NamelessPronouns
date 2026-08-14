import { z } from 'zod';
const isProd = process.env.NODE_ENV === 'production';
const SECRET_KEYS = [
  'COOKIE_SECRET',
  'POLICY_COOKIE_SECRET',
  'TOKEN_HASH_KEY',
  'ALTCHA_HMAC_KEY',
  'PASSWORD_PEPPER',
  'TOTP_ENCRYPTION_KEY',
  'CONTENT_FLAG_ENCRYPTION_KEY',
  'BAN_ENCRYPTION_KEY',
];
const PLACEHOLDER_PATTERNS = [/change-me/i, /replace-with/i, /^re_\.\.\.$/, /example\.com/i, /^$/];
const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));
const csv = (defaults = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v || defaults.join(','))
        .split(',')
        .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    );
export const DEFAULT_EMAIL_DOMAIN_ALLOWLIST = [
  'namelessnanashi.dev',
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.co.jp',
  'yahoo.ca', 'yahoo.com.au', 'yahoo.com.br', 'yahoo.de', 'yahoo.fr', 'yahoo.es', 'yahoo.in',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'tuta.com', 'tutanota.com', 'tutamail.com', 'keemail.me',
  'fastmail.com', 'fastmail.fm', 'mailbox.org', 'posteo.de', 'runbox.com',
  'startmail.com', 'hushmail.com', 'disroot.org', 'riseup.net',
  'aol.com', 'mail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch',
  'web.de', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru',
  'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'sina.cn', 'foxmail.com',
  'naver.com', 'daum.net', 'hanmail.net', 'seznam.cz', 'wp.pl', 'o2.pl',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'libero.it', 'virgilio.it',
  't-online.de', 'bluewin.ch', 'telenet.be', 'ziggo.nl', 'xs4all.nl',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'bigpond.com', 'optusnet.com.au',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'bellsouth.net', 'earthlink.net', 'shaw.ca', 'rogers.com',
];
const base64Key = (label) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const buf = Buffer.from(v, 'base64');
      if (buf.length !== 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a base64-encoded 32-byte key` });
        return z.NEVER;
      }
      return buf;
    });
const mailbox = (label) =>
  z.string().trim().refine(
    (value) =>
      /^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$/.test(value) ||
      /^[^<>\s@]+@[^<>\s@]+$/.test(value),
    { message: `${label} must be an email address or Name <email address>` },
  );
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  COOKIE_SECRET: z.string(),
  POLICY_COOKIE_SECRET: z.string(),
  TOKEN_HASH_KEY: z.string(),
  ALTCHA_HMAC_KEY: z.string(),
  ALTCHA_MAX_NUMBER: z.coerce.number().int().min(1000).max(2_000_000).default(400000),
  PASSWORD_PEPPER: z.string().optional().default(''),
  TOTP_ENCRYPTION_KEY: base64Key('TOTP_ENCRYPTION_KEY'),
  CONTENT_FLAG_ENCRYPTION_KEY: base64Key('CONTENT_FLAG_ENCRYPTION_KEY'),
  BAN_ENCRYPTION_KEY: base64Key('BAN_ENCRYPTION_KEY'),
  SECURE_COOKIES: bool(isProd),
  DB_BACKEND: z.enum(['postgres', 'd1']),
  DATABASE_URL: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_D1_DATABASE_ID: z.string().optional(),
  CLOUDFLARE_D1_API_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string(),
  RESEND_FROM: mailbox('RESEND_FROM'),
  ADMIN_NOTIFY_TO: mailbox('ADMIN_NOTIFY_TO'),
  TUNNEL_TOKEN: z.string().optional().default(''),
  DISPOSABLE_EMAIL_DOMAINS: csv(),
  DISPOSABLE_LIST_ENABLED: bool(true),
  DISPOSABLE_LIST_URL: z.string().optional().default(''),
  DISPOSABLE_REFRESH_HOURS: z.coerce.number().int().positive().default(24),
  EMAIL_DOMAIN_ALLOWLIST_ENABLED: bool(false),
  EMAIL_DOMAIN_ALLOWLIST: csv(DEFAULT_EMAIL_DOMAIN_ALLOWLIST),
  CONTENT_RULES_SEED_PATH: z.string().default('/app/config/content-rules.json'),
  CONTENT_WARNING_THRESHOLD: z.coerce.number().int().positive().default(3),
  CONTENT_WARNING_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  MAX_PROFILES_PER_USER: z.coerce.number().int().positive().max(100).default(5),
});
function fail(errors) {
  const lines = errors.map((e) => `  - ${e}`).join('\n');
  throw new Error(`Invalid configuration:\n${lines}`);
}
function validateSecrets(cfg, errors) {
  const seen = new Map();
  for (const key of SECRET_KEYS) {
    const val = cfg[key];
    if (key === 'PASSWORD_PEPPER' && (val === '' || val == null)) continue;
    if (key === 'BAN_ENCRYPTION_KEY' && val == null) continue;
    const str = Buffer.isBuffer(val) ? val.toString('base64') : val;
    if (!str) {
      errors.push(`${key} is required`);
      continue;
    }
    if (isProd && PLACEHOLDER_PATTERNS.some((re) => re.test(str))) {
      errors.push(`${key} still holds a placeholder value`);
    }
    if (!Buffer.isBuffer(val) && Buffer.byteLength(str, 'utf8') < 32) {
      errors.push(`${key} must be at least 32 bytes`);
    }
    if (seen.has(str)) errors.push(`${key} must differ from ${seen.get(str)}`);
    else seen.set(str, key);
  }
}
function validateBackend(cfg, errors) {
  if (cfg.DB_BACKEND === 'postgres') {
    if (!cfg.DATABASE_URL) errors.push('DATABASE_URL is required for DB_BACKEND=postgres');
  } else {
    for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN']) {
      if (!cfg[k]) errors.push(`${k} is required for DB_BACKEND=d1`);
    }
  }
}
function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    fail(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const cfg = parsed.data;
  const errors = [];
  validateSecrets(cfg, errors);
  validateBackend(cfg, errors);
  if (errors.length) fail(errors);
  cfg.isProd = cfg.NODE_ENV === 'production';
  cfg.passwordPepperEnabled = Boolean(cfg.PASSWORD_PEPPER);
  return Object.freeze(cfg);
}
export const config = load();
export default config;
