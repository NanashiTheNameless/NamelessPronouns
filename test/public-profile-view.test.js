import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { renderProfileMarkdown } from '../src/markdown.js';

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
    flags: [{ label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferences: [{ label: 'Ask me', opinion: 'Jokingly' }, { label: 'Use my name', opinion: 'Okay' }],
    descriptionHtml: '', notesHtml: '',
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
  assert.doesNotMatch(html, /staff-badge/, 'a non-staff profile shows no rank badge');
});

test('a public profile shows the account staff rank as a badge', async () => {
  const render = (staffBadge) => ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    staffBadge,
    names: [], pronouns: [], words: [], links: [], flags: [], pronounPreferences: [],
    descriptionHtml: '', notesHtml: '',
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(await render('Administrator'), /<span class="status-badge staff-badge">Administrator<\/span>/);
  assert.doesNotMatch(await render(null), /staff-badge/);
});

test('public profiles render the bio and notes as limited Markdown', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: 'ignored raw source', notes: 'ignored raw source' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [], pronouns: [], words: [], links: [], flags: [], pronounPreferences: [],
    descriptionHtml: await renderProfileMarkdown('# Hi\n**Alex** here, *hello*.', { full: false }),
    notesHtml: await renderProfileMarkdown('- ask first', { full: false }),
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /<div class="profile-prose profile-bio"><h2>Hi<\/h2><p><strong>Alex<\/strong> here, <em>hello<\/em>.<\/p><\/div>/);
  assert.match(html, /<div class="profile-prose"><ul><li>ask first<\/li><\/ul><\/div>/);
  assert.doesNotMatch(html, /ignored raw source/, 'the view never prints unrendered source');
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.profile-prose blockquote\s*\{/);
  assert.match(css, /\.profile-prose ul\s*\{/);
});
test('an unpublished profile page explains why the viewer can see it', async () => {
  const render = (extra) => ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { id: 'profile-1', display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [], pronouns: [], words: [], links: [], flags: [], pronounPreferences: [],
    descriptionHtml: '', notesHtml: '',
    obfuscateEmails: async (value) => value,
    ...extra,
  }, { async: true });
  const owner = await render({ preview: 'owner' });
  assert.match(owner, /Only you can see this page: this profile is yours and it is not published\./);
  assert.match(owner, /href="\/profiles\/profile-1\/edit"/);
  const staff = await render({ preview: 'staff' });
  assert.match(staff, /You can see this page because you are staff\. This profile is not published/);
  assert.doesNotMatch(staff, /href="\/profiles\/profile-1\/edit"/, 'staff get no edit link for someone else\'s profile');
  for (const html of [owner, staff]) assert.doesNotMatch(html, /editor/i, 'shared editing is no longer a feature');
  assert.doesNotMatch(await render({ preview: null }), /not published/);
  assert.doesNotMatch(await render({}), /not published/, 'the banner needs an explicit reason');
});
test('notes headings nest under the Notes section, and prose links stay distinct', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { id: 'profile-1', display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [], pronouns: [], words: [], links: [], flags: [], pronounPreferences: [],
    descriptionHtml: await renderProfileMarkdown('# Bio heading'),
    notesHtml: await renderProfileMarkdown('# Notes heading', { headingOffset: 1 }),
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /<h2>Bio heading<\/h2>/, 'the bio sits beside the page sections');
  assert.match(html, /<h2 id="notes-h">Notes<\/h2>\s*<div class="profile-prose"><h3>Notes heading<\/h3>/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.profile-prose a\s*\{[^}]*color:\s*var\(--link\)/s, 'prose links carry a color cue as well as an underline');
  assert.match(css, /\.profile-prose \{[^}]*border: 1px solid var\(--border\)/s, 'the bio and notes sit in a visible box');
  assert.match(css, /\.profile-prose \{[^}]*background: var\(--surface-strong\)/s);
  assert.match(css, /\.profile-prose \{[^}]*padding: 1rem 1\.15rem/s, 'with room between the border and the text');
  assert.match(css, /\.profile-prose \.md-underline\s*\{/, 'author underline is styled apart from links');
});
