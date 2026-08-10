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
    names: [{ value: 'Alex', opinion: 'Only if we\'re close' }],
    pronouns: [{ subject: 'they', object: 'them', possessive_determiner: 'their', possessive_pronoun: 'theirs', reflexive: 'themself', opinion: 'Yes' }],
    words: [{ heading: 'I am a', words: [{ value: 'person', opinion: 'Yes' }, { value: 'lad', opinion: 'Nope' }] }],
    links: [],
    flags: [{ label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png', opinion: 'Yes' }],
    pronounPreferences: [{ label: 'Ask me', opinion: 'Jokingly' }, { label: 'Use my name', opinion: 'Okay' }],
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /Pronoun preferences/);
  assert.match(html, /<h2 id="words-h">Words<\/h2>/);
  assert.match(html, /<h3 id="word-group-0">I am a<\/h3>/);
  assert.match(html, /<span class="opinion">Nope<\/span>/);
  assert.match(html, /<span class="opinion">Jokingly<\/span>/);
  assert.match(html, /Only if we&#39;re close/);
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
  assert.match(css, /\.opinion\s*\{[^}]*border-radius:\s*999px/s);
});
