import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileForm, autoSuspensionEligible } from '../src/routes/profile-editor.js';
import { ValidationError } from '../src/validation.js';
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
test('profile editor: requires link labels and allowed HTTPS URLs', () => {
  assert.throws(() => validateProfileForm(validBody({ link_label_0: '' })), /both a label and URL/);
  assert.throws(() => validateProfileForm(validBody({ link_url_0: 'javascript:alert(1)' })), ValidationError);
});
test('automatic suspension permanently excludes Administrator and Owner matches', () => {
  assert.equal(autoSuspensionEligible('none'), true);
  assert.equal(autoSuspensionEligible('support'), true);
  assert.equal(autoSuspensionEligible('moderator'), true);
  assert.equal(autoSuspensionEligible('administrator'), false);
  assert.equal(autoSuspensionEligible('owner'), false);
});
