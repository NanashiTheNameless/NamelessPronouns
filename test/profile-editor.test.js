import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { validateProfileForm, autoSuspensionEligible } from '../src/routes/profile-editor.js';
import { ValidationError } from '../src/validation.js';
import { PRONOUN_PRESETS } from '../src/pronoun-presets.js';
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
  assert.deepEqual(values.names, ['Alex']);
  assert.equal(values.pronouns[0].possessivePronoun, 'theirs');
  assert.equal(values.links[0].url, 'https://example.com/profile');
  assert.deepEqual(values.flags, []);
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
  assert.deepEqual(values.names, ['Alex', 'Lex']);
  assert.equal(values.pronouns.length, 2);
  assert.equal(values.links.length, 2);
  assert.deepEqual(values.flags, ['Nonbinary', 'Progress Pride']);
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
  });
});
test('profile editor: pronoun preferences are independent on/off toggles', () => {
  const values = validateProfileForm(validBody({
    pronoun_pref_any_pronouns: 'on',
    pronoun_pref_ask_me: 'on',
    pronoun_pref_varies: 'on',
    pronoun_pref_use_name: 'on',
    pronoun_pref_unknown: 'on',
  }));
  assert.deepEqual(values.pronounPreferences, ['any_pronouns', 'ask_me', 'varies', 'use_name']);
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
      names: [''],
      pronouns: [{ subject: '', object: '', possessiveDeterminer: '', possessivePronoun: '', reflexive: '' }],
      pronounPreferences: [],
      links: [{ label: '', url: '' }],
      flags: [''],
    },
    error: null, warning: null, saved: false, importNotice: null,
    csrfToken: 'csrf', saveId: 'save-id', user: null,
    flagOptions: [{ key: 'Nonbinary', label: 'Nonbinary', imageUrl: '/static/flags/Nonbinary.png' }],
    pronounPreferenceOptions: [
      { key: 'any_pronouns', label: 'Any pronouns' },
      { key: 'ask_me', label: 'Ask me' },
      { key: 'varies', label: 'Varies' },
      { key: 'use_name', label: 'Use my name' },
    ],
    pronounPresetOptions: PRONOUN_PRESETS,
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
  assert.match(html, /data-flag-picker/);
  assert.match(html, /data-flag-option/);
  assert.match(html, /src="\/static\/flags\/Nonbinary\.png"/);
  assert.doesNotMatch(html, /list="flag-options"|<datalist/);
  assert.match(html, /import\/pronouns-page/);
  assert.ok(html.indexOf('/edit">') < html.indexOf('/import/pronouns-page'), 'importer follows the profile form');
  assert.match(html, /placeholder="username, u\/username, or en\.pronouns\.page\/u\/username"/);
  assert.match(html, /name="display_name"[^>]+data-character-constraint/);
  assert.match(html, /name="subject"[^>]+data-character-constraint/);
  assert.match(html, /profile-editor\.js/);
});
test('pronoun preset script fills fields only after explicit application', async () => {
  const script = await readFile(new URL('../public/js/profile-editor.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/main.css', import.meta.url), 'utf8');
  assert.match(script, /data-apply-pronoun-preset/);
  assert.match(script, /selectedOptions\[0\]/);
  assert.match(script, /option\.dataset\[PRONOUN_DATA_FIELDS\[index\]\]/);
  assert.match(script, /validity\.patternMismatch/);
  assert.match(script, /data-illegal-characters/);
  assert.match(script, /data-flag-option/);
  assert.match(script, /data-flag-selected-image/);
  assert.doesNotMatch(script, /PRONOUN_PRESETS/);
  assert.doesNotMatch(script, /addEventListener\('change'/);
  assert.match(css, /\.pronoun-preset \[data-apply-pronoun-preset\]\s*\{[^}]*min-height:\s*2\.9rem[^}]*margin-top:\s*0/s);
  assert.match(css, /button\[data-remove\]\s*\{[^}]*min-height:\s*2\.9rem/s);
});
