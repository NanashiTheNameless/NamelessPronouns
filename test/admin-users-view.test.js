import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('admin user directory lists ranks and account information without plaintext email', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/users.ejs', import.meta.url)), {
    title: 'User directory',
    users: [{
      id: 'user-1', email: 'private@example.com', signup_status: 'approved', staff_role: 'administrator',
      twofa_method: 'totp', email_verified_at: 1, created_at: 1, updated_at: 2,
      profile_username: 'Example', profile_display_name: 'Example User', profile_count: 2, active_sessions: 1,
    }],
    page: 1, totalPages: 2, total: 101, user: null,
    obfuscateEmail: async () => '<span data-email-hidden>Protected email</span>',
  }, { async: true });
  assert.match(html, /User directory/);
  assert.match(html, /administrator/);
  assert.match(html, /approved/);
  assert.match(html, /Example User/);
  assert.match(html, /@Example/);
  assert.match(html, /totp 2FA/);
  assert.match(html, /1 active session/);
  assert.match(html, /\/admin\/accounts\/user-1/);
  assert.match(html, /\/admin\/users\?page=2/);
  assert.doesNotMatch(html, /private@example\.com/);
});

test('admin tools use a responsive action grid', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/admin/overview.ejs', import.meta.url)), {
    title: 'Administration', canReport: true, canApprove: true,
    pending: [], searched: null, email: '', csrfToken: 'csrf', user: null,
    obfuscateEmail: async () => '',
  }, { async: true });
  assert.match(html, /class="admin-tools-grid"/);
  assert.match(html, /href="\/admin\/users"/);
  assert.match(html, /href="\/admin\/reports"/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.admin-tools-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit/s);
});
