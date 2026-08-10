import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('public profiles show enabled pronoun preferences and local flags', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [],
    pronouns: [{ subject: 'they', object: 'them', possessive_determiner: 'their', possessive_pronoun: 'theirs', reflexive: 'themself' }],
    links: [],
    flags: [{ label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferences: ['Ask me', 'Use my name'],
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /Pronoun preferences/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-nav"/);
  assert.match(html, /Ask me/);
  assert.match(html, /Use my name/);
  assert.match(html, /src="\/static\/flags\/Nonbinary\.png"/);
  assert.match(html, /class="identity-flags-section"/);
  assert.match(html, /class="identity-flags"/);
  assert.doesNotMatch(html, /src="https:\/\//);
  assert.doesNotMatch(html, /data-copy|>Copy<|copy\.js/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.identity-flags\s*\{[^}]*justify-content:\s*center/s);
  assert.match(css, /\.identity-flags li\s*\{[^}]*text-align:\s*center/s);
});
