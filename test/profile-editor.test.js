import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { validateProfileForm, autoSuspensionEligible, markdownSettings } from '../src/routes/profile-editor.js';
import { fullMarkdownAllowed } from '../src/middleware/staff.js';
import { ValidationError } from '../src/validation.js';
import { PRONOUN_PRESETS } from '../src/pronoun-presets.js';
import { OPINIONS } from '../src/opinions.js';
function validBody(overrides = {}) {
  return {
    display_name: 'Alex Example',
    description: 'Simple Profile',
    notes: '',
    name_0: 'Alex',
    subject_0: 'they',
    object_0: 'them',
    possessive_determiner_0: 'their',
    possessive_pronoun_0: 'theirs',
    reflexive_0: 'themself',
    link_label_0: 'Website',
    link_url_0: 'https://example.com/profile',
    published: 'on',
    ...overrides,
  };
}
test('profile editor: validates and structures an accepted form', () => {
  const values = validateProfileForm(validBody());
  assert.equal(values.displayName, 'Alex Example');
  assert.equal(values.published, true);
  assert.deepEqual(values.names, [{ value: 'Alex', opinion: 'yes' }]);
  assert.equal(values.pronouns[0].possessivePronoun, 'theirs');
  assert.equal(values.links[0].url, 'https://example.com/profile');
  assert.deepEqual(values.flags, []);
  assert.deepEqual(values.words, []);
  assert.deepEqual(values.pronounPreferences, []);
});
test('profile editor: accepts dynamic repeated rows and identity flags', () => {
  const values = validateProfileForm({
    ...validBody(),
    name: ['Alex', 'Lex'],
    subject: ['they', 'xe'],
    object: ['them', 'xem'],
    possessive_determiner: ['their', 'xyr'],
    possessive_pronoun: ['theirs', 'xyrs'],
    reflexive: ['themself', 'xemself'],
    link_label: ['Website', 'Social'],
    link_url: ['https://example.com', 'https://social.example.com'],
    profile_flag: ['Nonbinary', 'Progress Pride'],
  });
  assert.deepEqual(values.names.map((row) => row.value), ['Alex', 'Lex']);
  assert.equal(values.pronouns.length, 2);
  assert.equal(values.links.length, 2);
  assert.deepEqual(values.flags, ['Nonbinary', 'Progress Pride']);
});
test('profile editor: names, pronouns, preferences and words carry an opinion', () => {
  const values = validateProfileForm({
    ...validBody(),
    name: ['Alex', 'Lex'],
    name_opinion: ['yes', 'close'],
    subject: ['they', 'xe'],
    object: ['them', 'xem'],
    possessive_determiner: ['their', 'xyr'],
    possessive_pronoun: ['theirs', 'xyrs'],
    reflexive: ['themself', 'xemself'],
    pronoun_opinion: ['yes', 'jokingly'],
    profile_flag: ['Nonbinary', 'Queer'],
    pronoun_pref_any_pronouns: 'jokingly',
    word_group_heading: ['I am a'],
    word_value_0: ['person', 'nerd'],
    word_opinion_0: ['yes', 'nope'],
  });
  assert.deepEqual(values.names, [
    { value: 'Alex', opinion: 'yes' },
    { value: 'Lex', opinion: 'close' },
  ]);
  assert.deepEqual(values.pronouns.map((row) => row.opinion), ['yes', 'jokingly']);
  assert.deepEqual(values.flags, ['Nonbinary', 'Queer']);
  assert.deepEqual(values.pronounPreferences, [{ key: 'any_pronouns', opinion: 'jokingly' }]);
  assert.deepEqual(values.words, [{
    heading: 'I am a',
    words: [{ value: 'person', opinion: 'yes' }, { value: 'nerd', opinion: 'nope' }],
  }]);
});
test('profile editor: unknown opinions fall back to Yes', () => {
  const values = validateProfileForm(validBody({ name_opinion: 'maybe', pronoun_opinion: '' }));
  assert.equal(values.names[0].opinion, 'yes');
  assert.equal(values.pronouns[0].opinion, 'yes');
});
test('profile editor: word groups keep their own words and headings', () => {
  const values = validateProfileForm({
    ...validBody(),
    word_group_heading: ['I am a...', 'Call me'],
    word_value_0: ['person', ''],
    word_opinion_0: ['okay', 'yes'],
    word_value_1: 'captain',
    word_opinion_1: 'jokingly',
  });
  assert.deepEqual(values.words, [
    { heading: 'I am a...', words: [{ value: 'person', opinion: 'okay' }] },
    { heading: 'Call me', words: [{ value: 'captain', opinion: 'jokingly' }] },
  ]);
});
test('profile editor: word groups drop empty rows and demand complete groups', () => {
  assert.deepEqual(validateProfileForm({ ...validBody(), word_group_heading: [''], word_value_0: [''] }).words, []);
  assert.throws(
    () => validateProfileForm({ ...validBody(), word_group_heading: [''], word_value_0: ['person'] }),
    /needs a heading/,
  );
  assert.throws(
    () => validateProfileForm({ ...validBody(), word_group_heading: ['I am a'], word_value_0: [''] }),
    /at least one word/,
  );
  assert.throws(
    () => validateProfileForm({ ...validBody(), word_group_heading: ['fancy \u{1D4EF}'], word_value_0: ['person'] }),
    ValidationError,
  );
});
test('profile editor: short display fields reject punctuation and non-ASCII', () => {
  assert.throws(() => validateProfileForm(validBody({ display_name: 'bad<script>' })), ValidationError);
  assert.throws(() => validateProfileForm(validBody({ name_0: 'na<b>me' })), ValidationError);
  assert.throws(() => validateProfileForm(validBody({ display_name: 'naïve' })), ValidationError);
});
test('profile editor: prose fields allow punctuation but reject fancy/special characters', () => {
  const ok = validateProfileForm(validBody({ description: "Hi! I'm Alex (they/them) - nice to meet you." }));
  assert.equal(ok.description, "Hi! I'm Alex (they/them) - nice to meet you.");
  assert.throws(() => validateProfileForm(validBody({ description: 'fancy \u{1D4EF}' })), ValidationError);
  assert.throws(() => validateProfileForm(validBody({ notes: 'emoji \u{1F600}' })), ValidationError);
});
test('profile editor: requires complete pronoun sets', () => {
  assert.throws(() => validateProfileForm(validBody({ reflexive_0: '' })), /Every field/);
});
test('profile editor: removes completely empty pronoun rows on save', () => {
  const values = validateProfileForm({
    ...validBody(),
    subject: ['they', ''],
    object: ['them', ''],
    possessive_determiner: ['their', ''],
    possessive_pronoun: ['theirs', ''],
    reflexive: ['themself', ''],
  });
  assert.equal(values.pronouns.length, 1);
  assert.equal(values.pronouns[0].subject, 'they');
});
test('profile editor: custom pronouns remain independent of presets', () => {
  const values = validateProfileForm(validBody({
    subject_0: 'star', object_0: 'star', possessive_determiner_0: "star's",
    possessive_pronoun_0: "star's", reflexive_0: 'starself',
  }));
  assert.deepEqual(values.pronouns[0], {
    subject: 'star', object: 'star', possessiveDeterminer: "star's", possessivePronoun: "star's", reflexive: 'starself',
    opinion: 'yes',
  });
});
test('profile editor: pronoun preferences are independent opinion choices', () => {
  const values = validateProfileForm(validBody({
    pronoun_pref_any_pronouns: 'on',
    pronoun_pref_ask_me: 'close',
    pronoun_pref_varies: 'nope',
    pronoun_pref_use_name: 'okay',
    pronoun_pref_no_pronouns: '',
    pronoun_pref_mirror_pronouns: 'not-an-opinion',
    pronoun_pref_unknown: 'yes',
  }));
  assert.deepEqual(values.pronounPreferences, [
    { key: 'any_pronouns', opinion: 'yes' },
    { key: 'ask_me', opinion: 'close' },
    { key: 'varies', opinion: 'nope' },
    { key: 'use_name', opinion: 'okay' },
  ]);
});
test('profile editor: requires link labels and allowed HTTPS URLs', () => {
  assert.throws(() => validateProfileForm(validBody({ link_label_0: '' })), /both a label and URL/);
  assert.throws(() => validateProfileForm(validBody({ link_url_0: 'javascript:alert(1)' })), ValidationError);
});
test('profile editor: flags must use an available Pronouns.page key', () => {
  assert.throws(() => validateProfileForm(validBody({ profile_flag: 'Not a real flag' })), /Choose a flag/);
  assert.deepEqual(validateProfileForm(validBody({ profile_flag: 'Queer' })).flags, ['Queer']);
});
test('automatic suspension permanently excludes Administrator and Owner matches', () => {
  assert.equal(autoSuspensionEligible('none'), true);
  assert.equal(autoSuspensionEligible('support'), true);
  assert.equal(autoSuspensionEligible('moderator'), true);
  assert.equal(autoSuspensionEligible('administrator'), false);
  assert.equal(autoSuspensionEligible('owner'), false);
});
test('profile editor renders one row per empty category and add-another controls', async () => {
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/profile-edit.ejs', import.meta.url)), {
    title: 'Edit example',
    profile: { id: 'profile-1', username: 'example' },
    values: {
      displayName: 'Example', description: '', notes: '', published: false,
      names: [{ value: '', opinion: 'yes' }],
      pronouns: [{ subject: '', object: '', possessiveDeterminer: '', possessivePronoun: '', reflexive: '', opinion: 'yes' }],
      pronounPreferences: [],
      words: [{ heading: '', words: [{ value: '', opinion: 'yes' }] }],
      links: [{ label: '', url: '' }],
      flags: [''],
    },
    error: null, warning: null, saved: false, importNotice: null,
    markdown: { level: 'limited', allowLinks: false, max: 2000 },
    csrfToken: 'csrf', saveId: 'save-id', user: null,
    flagOptions: [{ key: 'Nonbinary', label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferenceOptions: [
      { key: 'any_pronouns', label: 'Any pronouns' },
      { key: 'ask_me', label: 'Ask me' },
      { key: 'varies', label: 'Varies' },
      { key: 'use_name', label: 'Use my name' },
    ],
    pronounPresetOptions: PRONOUN_PRESETS,
    opinionOptions: OPINIONS,
  }, { async: true });
  assert.equal((html.match(/<input name="name"/g) || []).length, 2, 'one active name and one inert template');
  assert.match(html, /Add another name/);
  assert.match(html, /Add another pronoun set/);
  for (const preset of ['he/him', 'she/her', 'they/them', 'it/its', 'xe/xem', 'ze/hir', 'fae/faer', 'ae/aer', 'co/cos', 'e/em/eir', 'ne/nem', 'per/per', 'thon/thons', 've/ver', 'vi/vir', 'zhe/zher', 'ki/kin']) {
    assert.match(html, new RegExp(`value="${preset.replace('/', '\\/')}"`));
  }
  assert.match(html, /value="one\/one&#39;s"/);
  assert.match(html, /data-apply-pronoun-preset/);
  for (const preference of ['Any pronouns', 'Ask me', 'Varies', 'Use my name']) assert.match(html, new RegExp(preference));
  assert.match(html, /Add another link/);
  assert.match(html, /Add another flag/);
  assert.match(html, /Add another word group/);
  assert.match(html, /Add another word/);
  assert.match(html, /name="word_group_heading"/);
  assert.match(html, /name="word_value_0"/);
  assert.match(html, /name="word_opinion_0"/);
  assert.match(html, /name="name_opinion"/);
  assert.match(html, /name="pronoun_opinion"/);
  assert.match(html, /name="pronoun_pref_ask_me"/);
  assert.doesNotMatch(html, /type="checkbox" name="pronoun_pref_/);
  for (const opinion of ['Yes', 'Jokingly', 'Only if we&#39;re close', 'Okay', 'Nope']) {
    assert.match(html, new RegExp(`>${opinion}</option>`));
  }
  assert.match(html, /<option value="" selected>Not listed<\/option>/);
  assert.match(html, /data-flag-picker/);
  assert.match(html, /data-flag-option/);
  assert.match(html, /src="\/static\/flags\/Nonbinary\.png"/);
  assert.doesNotMatch(html, /list="flag-options"|<datalist/);
  assert.match(html, /import\/pronouns-page/);
  assert.ok(html.indexOf('/edit">') < html.indexOf('/import/pronouns-page'), 'importer follows the profile form');
  assert.match(html, /placeholder="A Pronouns\.page username or profile URL to copy fields from"/);
  assert.match(html, /name="display_name"[^>]+data-character-constraint/);
  assert.match(html, /name="subject"[^>]+data-character-constraint/);
  assert.doesNotMatch(
    html,
    /data-character-constraint(?![^>]*data-character-hint)/,
    'every constrained field carries its own message instead of the browser default',
  );
  assert.match(html, /data-character-hint="Use only letters, numbers, spaces, and dashes\."/);
  assert.match(html, /data-character-hint="Enter an HTTPS URL that starts with https:\/\/\."/);
  assert.match(html, /profile-editor\.js/);
});
test('profile editor offers tall Markdown-aware prose fields with a cheatsheet', async () => {
  const render = (markdown) => ejs.renderFile(fileURLToPath(new URL('../views/profile-edit.ejs', import.meta.url)), {
    title: 'Edit example',
    profile: { id: 'profile-1', username: 'example' },
    values: {
      displayName: 'Example', description: '', notes: '', published: false,
      names: [{ value: '', opinion: 'yes' }],
      pronouns: [{ subject: '', object: '', possessiveDeterminer: '', possessivePronoun: '', reflexive: '', opinion: 'yes' }],
      pronounPreferences: [],
      words: [{ heading: '', words: [{ value: '', opinion: 'yes' }] }],
      links: [{ label: '', url: '' }],
      flags: [''],
    },
    error: null, warning: null, saved: false, importNotice: null,
    markdown,
    csrfToken: 'csrf', saveId: 'save-id', user: null,
    flagOptions: [],
    pronounPreferenceOptions: [],
    pronounPresetOptions: PRONOUN_PRESETS,
    opinionOptions: OPINIONS,
  }, { async: true });
  const html = await render({ full: false, max: 2000 });
  assert.match(html, /<label for="description">About me/);
  assert.match(html, /<textarea id="description"[^>]*class="tall"[^>]*rows="14"[^>]*maxlength="2000"[^>]*data-character-constraint/);
  assert.match(html, /<textarea id="notes"[^>]*rows="10"[^>]*maxlength="2000"[^>]*data-character-constraint/);
  assert.doesNotMatch(html, /<input name="description"|<input name="notes"/, 'both prose fields are textareas now');
  assert.equal((html.match(/Limited Markdown is supported/g) || []).length, 2, 'both prose fields carry the note');
  assert.match(html, /<details class="markdown-help">/, 'the cheatsheet opens from the note itself');
  assert.match(html, /Not supported/);
  assert.match(html, /Images, video, and embeds/);
  assert.match(html, /available to Administrator accounts only/);
  assert.doesNotMatch(html, /<dd>Hyperlink/);
  assert.doesNotMatch(html, /what you are into/, 'the bio hint stays plain');
  assert.match(html, /data-character-set="\[\\x20-\\x7E\\n\]"/);
  assert.equal((html.match(/data-character-report/g) || []).length, 2, 'each prose field reports its illegal characters');
  const adminHtml = await render({ full: true, max: 2000 });
  assert.equal((adminHtml.match(/Full Markdown is supported/g) || []).length, 2);
  assert.match(adminHtml, /Numbered list/);
  assert.match(adminHtml, /Nested list under the item above/);
  assert.match(adminHtml, /Horizontal rule/);
  assert.match(adminHtml, /Code block/);
  assert.match(adminHtml, /Table, with/);
  assert.match(adminHtml, /<dd>Hyperlink, HTTPS only<\/dd>/);
  assert.match(adminHtml, /Raw HTML/, 'raw HTML stays unsupported at every level');
  assert.doesNotMatch(adminHtml, /Numbered lists and nested lists<\/li>/);
  assert.match(html, /id="description-characters" role="status" aria-live="polite" data-character-report/,
    'the live character report is polite, not an interrupting alert');
  assert.doesNotMatch(html, /role="alert" data-character-report/);
  assert.match(html, /<textarea id="description"[^>]*aria-describedby="description-characters description-hint"/);
  assert.match(html, /<textarea id="notes"[^>]*aria-describedby="notes-characters notes-hint"/);
  assert.doesNotMatch(html, /<h3>/, 'the cheatsheet does not skip from h1 to h3');
  assert.match(html, /<h2 class="markdown-help-subhead">Supported<\/h2>/);
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.prose-field textarea\s*\{[^}]*min-height:\s*11rem/s);
  assert.match(css, /\.prose-field textarea\.tall\s*\{[^}]*min-height:\s*17rem/s);
});
test('profile editor: prose fields keep Markdown links for Administrators only', () => {
  const body = validBody({ description: 'See [my site](https://example.com/me).' });
  assert.throws(() => validateProfileForm(body), /Administrator accounts only/);
  assert.equal(
    validateProfileForm(body, { full: true }).description,
    'See [my site](https://example.com/me).',
  );
  assert.throws(() => validateProfileForm(validBody({ notes: '[x](https://example.com)' })), /Administrator accounts only/);
  assert.equal(fullMarkdownAllowed('none'), false);
  assert.equal(fullMarkdownAllowed('support'), false);
  assert.equal(fullMarkdownAllowed('moderator'), false);
  assert.equal(fullMarkdownAllowed('administrator'), true);
  assert.equal(fullMarkdownAllowed('owner'), true);
  assert.deepEqual(markdownSettings('none'), { full: false, max: 2000 });
  assert.deepEqual(markdownSettings('administrator'), { full: true, max: 2000 });
});
test('profile editor: prose fields hold a multi-paragraph bio', () => {
  const bio = ['# About me', '', '**Hi** - I like _prose_.', 'Second line.'].join('\n');
  const values = validateProfileForm(validBody({ description: bio, notes: bio }));
  assert.equal(values.description, bio);
  assert.equal(values.notes, bio);
  assert.equal(validateProfileForm(validBody({ description: 'x'.repeat(2000) })).description.length, 2000);
  assert.throws(() => validateProfileForm(validBody({ description: 'x'.repeat(2001) })), /at most 2000/);
  assert.throws(() => validateProfileForm(validBody({ notes: 'x'.repeat(2001) })), /at most 2000/);
});
test('profile editor: prose fields keep indentation for nested Markdown', () => {
  const source = ['1. one', '  - nested', '', '```js', '  const x = 1;', '```'].join('\n');
  assert.equal(validateProfileForm(validBody({ description: source })).description, source);
});
test('profile editor: prose fields reject fake-font and invisible Unicode', () => {
  for (const bad of ['\u{1D5D4}\u{1D5D5}', 'th\u200bin', 'ne\u0301gation', 'a\u202Eb', '\u{1F308} pride', 'caf\u00e9', 'wide \uFF41\uFF42']) {
    assert.throws(
      () => validateProfileForm(validBody({ description: bad })),
      /only standard English letters/,
      `${JSON.stringify(bad)} must be rejected`,
    );
    assert.throws(() => validateProfileForm(validBody({ notes: bad })), /only standard English letters/);
  }
});
test('pronoun preset script fills fields only after explicit application', async () => {
  const script = await readFile(new URL('../public/js/profile-editor.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(script, /data-apply-pronoun-preset/);
  assert.match(script, /selectedOptions\[0\]/);
  assert.match(script, /option\.dataset\[PRONOUN_DATA_FIELDS\[index\]\]/);
  assert.match(script, /validity\.patternMismatch/);
  assert.match(script, /setCustomValidity/);
  assert.match(script, /data-illegal-characters/);
  assert.match(script, /data-flag-option/);
  assert.match(script, /data-flag-selected-image/);
  assert.doesNotMatch(script, /PRONOUN_PRESETS/);
  assert.doesNotMatch(script, /addEventListener\('change'/);
  assert.match(css, /\.pronoun-preset \[data-apply-pronoun-preset\]\s*\{[^}]*min-height:\s*2\.9rem[^}]*margin-top:\s*0/s);
  assert.match(css, /button\[data-remove\]\s*\{[^}]*min-height:\s*2\.9rem/s);
});
test('constrained fields state their own validation message', async () => {
  const script = await readFile(new URL('../public/js/profile-editor.js', import.meta.url), 'utf8');
  const shared = await readFile(new URL('../public/js/field-messages.js', import.meta.url), 'utf8');
  const footer = await readFile(new URL('../views/partials/site-footer.ejs', import.meta.url), 'utf8');
  assert.match(script, /field\.setCustomValidity\(message\)/, 'the editor replaces the browser format message');
  assert.match(script, /dataset\.characterHint/);
  assert.match(script, /PATTERN_CLASS/, 'allowed characters come from the pattern when no set is given');
  assert.match(shared, /dataset\.invalidMessage/);
  assert.match(shared, /setCustomValidity\(message\)/);
  assert.match(footer, /field-messages\.js/, 'the shared message script loads on every page');
  for (const view of ['account/reauth', 'account/security', 'auth/twofa', 'auth/password-reset']) {
    const html = await readFile(new URL(`../views/${view}.ejs`, import.meta.url), 'utf8');
    assert.match(html, /data-invalid-message="Enter the 6-digit code, digits only\."/, `${view} names its own error`);
  }
});
