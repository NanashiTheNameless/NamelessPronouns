import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { renderProfileMarkdown } from '../src/markdown.js';
import { PLACEHOLDER_PROFILES } from '../src/routes/public-profile.js';
import { isOpinion, opinionLabel, opinionView } from '../src/opinions.js';

test('public profiles show enabled pronoun preferences and local flags', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    names: [{ value: 'Alex', opinion: opinionView('close') }],
    pronouns: [{ subject: 'they', object: 'them', possessive_determiner: 'their', possessive_pronoun: 'theirs', reflexive: 'themself', opinion: opinionView('yes') }],
    words: [{ heading: 'I am a', words: [{ value: 'person', opinion: opinionView('yes') }, { value: 'lad', opinion: opinionView('nope') }] }],
    links: [],
    flags: [{ label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferences: [{ label: 'Ask me', opinion: opinionView('jokingly') }, { label: 'Use my name', opinion: opinionView('okay') }],
    descriptionHtml: '', notesHtml: '',
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /Pronoun preferences/);
  assert.match(html, /<h2 id="words-h">Words<\/h2>/);
  assert.match(html, /<h3 id="word-group-0">I am a<\/h3>/);
  assert.match(html, /<span class="opinion" data-opinion="nope">Nope<\/span><span class="opinion-value">lad<\/span>/, 'the opinion is stated before the word it judges');
  assert.match(html, /<span class="opinion" data-opinion="jokingly">Jokingly<\/span><span class="opinion-value">Ask me<\/span>/);
  assert.match(html, /<span class="opinion" data-opinion="close">Only if we&#39;re close<\/span><span class="opinion-value">Alex<\/span>/);
  assert.match(html, /data-opinion="yes">Yes<\/span>\s*<span class="pronoun-set opinion-value">they\/them/);
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
  assert.match(html, /<p class="print-easter-egg">This profile escaped the internet\.<\/p>/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.identity-flags\s*\{[^}]*justify-content:\s*center/s);
  assert.match(css, /\.identity-flags li\s*\{[^}]*text-align:\s*center/s);
  assert.match(css, /\.opinion\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(css, /\.print-easter-egg\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media print\s*\{[^}]*\.print-easter-egg\s*\{[^}]*display:\s*block/s);
  assert.doesNotMatch(html, /staff-badge/, 'a non-staff profile shows no rank badge');
});

test('a public profile shows the account staff rank as a badge', async () => {
  const render = (staffBadge, staffBadgeLine, ownerEgg = false) => ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Example',
    profile: { display_name: 'Example', description: '', notes: '' },
    username: 'example',
    avatar: '/static/avatar.svg',
    staffBadge,
    staffBadgeLine,
    ownerEgg,
    names: [], pronouns: [], words: [], links: [], flags: [], pronounPreferences: [],
    descriptionHtml: '', notesHtml: '',
    obfuscateEmails: async (value) => value,
  }, { async: true });
  const staff = await render('Administrator', 'keeps the lights on');
  assert.match(staff, /class="status-badge staff-badge"[^>]*tabindex="0"[^>]*>Administrator<\/span>/);
  assert.match(staff, /role="tooltip">keeps the lights on<\/span>/);
  assert.doesNotMatch(await render(null), /staff-badge/);
  const owner = await render('Owner', 'wrote this bit', true);
  assert.match(owner, /<h1 data-owner-heading>Example<\/h1>/);
  assert.match(owner, /data-owner-badge/);
  assert.match(owner, /Approved for escape by NamelessNanashi/);
});

test('a profile with eleven flags earns the collector caption', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Collector', profile: { display_name: 'Collector' }, username: 'collector',
    avatar: '/static/avatar.svg', names: [], pronouns: [], words: [], links: [],
    flags: Array.from({ length: 11 }, (_, index) => ({ label: `Flag ${index}`, imageUrl: `/flag-${index}.png` })),
    pronounPreferences: [], descriptionHtml: '', notesHtml: '',
  }, { async: true });
  assert.match(html, /class="fineprint flag-collector">Collector\.<\/p>/);
  const sparse = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
    title: 'Sparse', profile: { display_name: 'Sparse' }, username: 'sparse',
    avatar: '/static/avatar.svg', names: [], pronouns: [], words: [], links: [],
    flags: Array.from({ length: 10 }, (_, index) => ({ label: `Flag ${index}`, imageUrl: `/flag-${index}.png` })),
    pronounPreferences: [], descriptionHtml: '', notesHtml: '',
  }, { async: true });
  assert.doesNotMatch(sparse, /flag-collector/);
});

test('reserved profiles each have distinct bios, notes, pronouns, and personality', async () => {
  assert.ok(PLACEHOLDER_PROFILES.root, 'root has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.void, 'void has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.infinity, 'infinity has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.everything, 'everything has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.nothing, 'nothing has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.someone, 'someone has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.something, 'something has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.unknown, 'unknown has a reserved placeholder profile');
  assert.ok(PLACEHOLDER_PROFILES.else, 'else has a reserved placeholder profile');
  const seenBios = new Set();
  const seenNotes = new Set();
  for (const [username, placeholder] of Object.entries(PLACEHOLDER_PROFILES)) {
    assert.ok(placeholder.bio && placeholder.notes, `${username} has both prose sections`);
    assert.ok(placeholder.pronouns.length >= 2, `${username} has more than a token pronoun row`);
    assert.ok(placeholder.names.length >= 2, `${username} has joke names`);
    assert.ok(placeholder.words[0]?.words.length >= 2, `${username} has word preferences`);
    const opinionRows = [
      ...placeholder.names,
      ...placeholder.pronouns,
      ...placeholder.words.flatMap((group) => group.words),
    ];
    for (const row of opinionRows) assert.equal(isOpinion(row.opinion), true, `${username} uses valid opinion ${row.opinion}`);
    assert.equal(seenBios.has(placeholder.bio), false, `${username} has a unique bio`);
    assert.equal(seenNotes.has(placeholder.notes), false, `${username} has unique notes`);
    seenBios.add(placeholder.bio);
    seenNotes.add(placeholder.notes);
    const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile.ejs', import.meta.url)), {
      title: placeholder.displayName,
      profile: { display_name: placeholder.displayName },
      username,
      avatar: '/static/avatar.svg',
      names: placeholder.names.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
      pronouns: placeholder.pronouns.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
      words: placeholder.words.map((group) => ({
        ...group,
        words: group.words.map((row) => ({ ...row, opinion: opinionLabel(row.opinion) })),
      })),
      links: [], flags: [], pronounPreferences: [],
      descriptionHtml: await renderProfileMarkdown(placeholder.bio, { full: false }),
      notesHtml: await renderProfileMarkdown(placeholder.notes, { full: false, headingOffset: 1 }),
    }, { async: true });
    assert.match(html, new RegExp(`<h1>${placeholder.displayName}<\\/h1>`));
    assert.match(html, /<h2 id="notes-h">Notes<\/h2>/);
    for (const pronoun of placeholder.pronouns) assert.match(html, new RegExp(`>${pronoun.short.replace('/', '\\/')}<`));
  }
});

test('the Owner profile response carries its diagnostic status header', async () => {
  const route = await readFile(new URL('../src/routes/public-profile.js', import.meta.url), 'utf8');
  assert.match(route, /if \(profile\.staff_role === 'owner'\) res\.setHeader\('X-Owner-Status', 'probably-debugging'\);/);
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
  assert.match(css, /\.profile-heading\s*\{[^}]*gap:\s*clamp\(1rem, 2\.5vw, 1\.5rem\)[^}]*margin-bottom:\s*clamp\(1rem, 2\.5vw, 1\.5rem\)/s,
    'the avatar and identity block leave responsive space before the bio');
  assert.match(css, /@media \(max-width: 38rem\)[\s\S]*?\.avatar-large\s*\{[^}]*width:\s*5rem[^}]*height:\s*5rem/s,
    'the avatar and gap compact on narrow screens');
});

test('the collector caption stays inside the flag limit the editor enforces', async () => {
  const view = await readFile(new URL('../views/profile.ejs', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../src/routes/profile-editor.js', import.meta.url), 'utf8');
  const threshold = Number(/flags\.length >= (\d+)/.exec(view)?.[1]);
  const cap = Number(/const MAX_ROWS = (\d+)/.exec(editor)?.[1]);
  assert.ok(Number.isInteger(threshold) && Number.isInteger(cap), 'both numbers were found');
  assert.ok(
    threshold <= cap,
    `a profile can hold at most ${cap} flags, so a caption needing ${threshold} must stay under it`,
  );
});
