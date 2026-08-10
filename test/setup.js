const secret = (s) => `${s}${'x'.repeat(Math.max(0, 32 - s.length))}`;
Object.assign(process.env, {
  NODE_ENV: 'test',
  BASE_URL: 'https://test.example.com',
  COOKIE_SECRET: secret('cookie-secret-'),
  POLICY_COOKIE_SECRET: secret('policy-secret-'),
  TOKEN_HASH_KEY: secret('token-hash-key-'),
  ALTCHA_HMAC_KEY: secret('altcha-hmac-key-'),
  ALTCHA_MAX_NUMBER: '4000',
  PASSWORD_PEPPER: '',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CONTENT_FLAG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DB_BACKEND: 'postgres',
  DATABASE_URL: 'postgres://u:p@localhost:5432/test',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Test <t@test.example.com>',
  ADMIN_NOTIFY_TO: 'Admin <admin@test.example.com>',
});
