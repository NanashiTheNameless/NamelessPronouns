import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';

test('public profiles show enabled pronoun preferences and local flags', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [],
    pronouns: [],
    links: [],
    flags: [{ label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferences: ['Ask me', 'Use my name'],
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /Pronoun preferences/);
  assert.match(html, /Ask me/);
  assert.match(html, /Use my name/);
  assert.match(html, /src="\/static\/flags\/Nonbinary\.png"/);
  assert.doesNotMatch(html, /src="https:\/\//);
});
