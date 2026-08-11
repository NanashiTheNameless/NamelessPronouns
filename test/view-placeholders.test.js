import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const viewsDir = fileURLToPath(new URL('../views', import.meta.url));
const FIELD = /<(input|textarea)\b(?:<%.*?%>|[^>])*>/g;
const SKIPPED_TYPES = ['type="hidden"', 'type="checkbox"', 'type="radio"', 'type="file"'];
async function viewFiles(dir = viewsDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await viewFiles(full));
    else if (entry.name.endsWith('.ejs')) files.push(full);
  }
  return files;
}
test('every text entry field explains itself in its placeholder', async () => {
  const files = await viewFiles();
  assert.ok(files.length > 20, 'the whole view tree is scanned');
  const missing = [];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const [tag] of source.matchAll(FIELD)) {
      if (SKIPPED_TYPES.some((skipped) => tag.includes(skipped))) continue;
      checked += 1;
      const placeholder = /placeholder="([^"]*)"/.exec(tag);
      if (!placeholder || placeholder[1].trim() === '') {
        missing.push(`${path.relative(viewsDir, file)}: ${tag.slice(0, 90)}`);
      }
    }
  }
  assert.ok(checked > 80, `every entry field is inspected (saw ${checked})`);
  assert.deepEqual(missing, [], 'these fields still fall back to an empty box');
});
test('signup fields say what belongs in them', async () => {
  const source = await readFile(new URL('../views/auth/signup.ejs', import.meta.url), 'utf8');
  const placeholderFor = (name) => new RegExp(`name="${name}"(?:<%.*?%>|[^>])*placeholder="([^"]+)"`).exec(source)?.[1];
  assert.match(placeholderFor('email'), /address you will verify and sign in with/);
  assert.match(placeholderFor('password'), /At least 12 characters/);
  assert.match(placeholderFor('profile_username'), /single hyphens between them/, 'the username rule is spelled out');
  assert.match(placeholderFor('display_name'), /shown on your profile/);
  assert.match(placeholderFor('reason'), /invited you/);
  for (const name of ['email', 'profile_username', 'display_name']) {
    assert.doesNotMatch(placeholderFor(name), /example\.com|@|^[a-z]+-[a-z0-9]+$/, `${name} explains itself instead of showing a sample value`);
  }
});
test('confirmation fields show the exact phrase they demand', async () => {
  const cases = [
    ['account/deletion.ejs', 'DELETE MY ACCOUNT'],
    ['account/security.ejs', 'REPLACE RECOVERY CODES'],
    ['admin/legal-holds.ejs', 'CREATE LEGAL HOLD'],
    ['admin/account-detail.ejs', 'REVOKE ALL SESSIONS'],
    ['admin/suspensions.ejs', 'TERMINATE ACCOUNT'],
  ];
  for (const [view, phrase] of cases) {
    const source = await readFile(path.join(viewsDir, view), 'utf8');
    assert.ok(source.includes(`Type ${phrase}`), `${view} still asks for ${phrase}`);
    assert.ok(source.includes(`placeholder="${phrase}"`), `${view} shows ${phrase} as the placeholder`);
  }
});
test('placeholder text is dimmer than typed text', async () => {
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /--placeholder:\s*#b8b3bf/);
  assert.match(css, /::placeholder\s*\{[^}]*color:\s*var\(--placeholder\)/s);
  assert.doesNotMatch(css, /::placeholder\s*\{[^}]*color:\s*var\(--text\)/s, 'a placeholder must not look like a value');
});

test('repeated dashboard actions name the profile they act on', async () => {
  const source = await readFile(new URL('../views/dashboard.ejs', import.meta.url), 'utf8');
  for (const [label, aria] of [
    ['Edit', 'Edit <%= profile.username %>'],
    ['View public page', 'View the public page for <%= profile.username %>'],
    ['Preview page', 'Preview the unpublished page for <%= profile.username %>'],
  ]) {
    assert.ok(source.includes(`aria-label="${aria}">${label}</a>`), `${label} carries a distinguishing name`);
  }
  assert.doesNotMatch(source, /<a href="\/u\/<%= profile\.username %>">/, 'no action link is left unnamed');
});
