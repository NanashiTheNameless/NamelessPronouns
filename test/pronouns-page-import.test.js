import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPronounsPageProfile,
  parsePronounsPageReference,
  pronounsPageFlagUrl,
  PRONOUNS_PAGE_FLAG_OPTIONS,
} from '../src/pronouns-page-import.js';
import { PRONOUN_PRESETS, pronounPresetForms } from '../src/pronoun-presets.js';

const current = {
  displayName: 'Local Name',
  description: '',
  notes: 'Keep this',
  published: true,
  names: [''],
  pronouns: [],
  pronounPreferences: [],
  links: [],
  flags: [],
};

test('Pronouns.page references accept usernames and official profile URLs only', () => {
  assert.deepEqual(parsePronounsPageReference('@Alex-1'), { username: 'Alex-1', locale: 'en' });
  assert.deepEqual(parsePronounsPageReference('u/Alex-1'), { username: 'Alex-1', locale: 'en' });
  assert.deepEqual(parsePronounsPageReference('/u/Alex-1'), { username: 'Alex-1', locale: 'en' });
  assert.deepEqual(parsePronounsPageReference('https://pl.pronouns.page/@Alex-1'), { username: 'Alex-1', locale: 'pl' });
  assert.deepEqual(parsePronounsPageReference('https://en.pronouns.page/u/Alex-1'), { username: 'Alex-1', locale: 'en' });
  assert.deepEqual(parsePronounsPageReference('en.pronouns.page/u/Alex-1'), { username: 'Alex-1', locale: 'en' });
  assert.throws(() => parsePronounsPageReference('https://evil.example/@Alex-1'), /Only HTTPS Pronouns\.page/);
});

test('Pronouns.page profiles map into reviewable local fields', () => {
  const result = mapPronounsPageProfile({
    profiles: [{
      locale: 'en',
      access: true,
      description: 'Imported bio',
      names: [{ value: 'Alex', opinion: 'yes' }, { value: 'Not Alex', opinion: 'no' }],
      pronouns: [
        { value: 'they/them', opinion: 'yes' }, { value: 'custom/form', opinion: 'yes' },
        { value: 'he/him', opinion: 'no' }, { value: 'any', opinion: 'yes' },
        { value: 'ask-me', opinion: 'yes' }, { value: ':Alex', opinion: 'yes' }, { value: 'xe', opinion: 'yes' },
        { value: '\u00e6/\u00e6r', opinion: 'yes' },
      ],
      links: ['https://example.com/profile'],
      flags: ['Nonbinary', "Fa'afafine", 'Future Flag'],
      customFlags: [{ value: 'image-id', name: 'Custom' }],
    }],
  }, { locale: 'en', current });
  assert.equal(result.values.displayName, 'Local Name');
  assert.equal(result.values.notes, 'Keep this');
  assert.equal(result.values.published, true);
  assert.deepEqual(result.values.names, ['Alex']);
  assert.deepEqual(result.values.pronouns[0], {
    subject: 'they', object: 'them', possessiveDeterminer: 'their', possessivePronoun: 'theirs', reflexive: 'themselves',
  });
  assert.deepEqual(result.values.pronouns[1], {
    subject: 'xe', object: 'xem', possessiveDeterminer: 'xyr', possessivePronoun: 'xyrs', reflexive: 'xemself',
  });
  assert.deepEqual(result.values.pronouns[2], {
    subject: 'ae', object: 'aer', possessiveDeterminer: 'aer', possessivePronoun: 'aers', reflexive: 'aerself',
  });
  assert.deepEqual(result.values.links, [{ label: 'example com', url: 'https://example.com/profile' }]);
  assert.deepEqual(result.values.flags, ['Nonbinary', "Fa'afafine"]);
  assert.equal(result.skippedPronouns, 1);
  assert.deepEqual(result.values.pronounPreferences, ['any_pronouns', 'ask_me', 'use_name']);
  assert.equal(result.skippedCustomFlags, 1);
  assert.equal(result.skippedFlags, 1);
});

test('every editor preset and Pronouns.page alias uses the shared forms', () => {
  assert.equal(PRONOUN_PRESETS.length, 26);
  for (const preset of PRONOUN_PRESETS) {
    assert.deepEqual(pronounPresetForms(preset.key), preset.forms);
    for (const alias of preset.aliases) assert.deepEqual(pronounPresetForms(alias), preset.forms);
  }
});

test('Pronouns.page ligature spellings import as ASCII ae forms', () => {
  assert.deepEqual(pronounPresetForms('\u00e6/\u00e6r'), ['ae', 'aer', 'aer', 'aers', 'aerself']);
  assert.deepEqual(pronounPresetForms('f\u00e6/f\u00e6r'), ['fae', 'faer', 'faer', 'faers', 'faerself']);
});

test('Pronouns.page flag URLs encode keys on the local static asset path', () => {
  assert.equal(pronounsPageFlagUrl("Fa'afafine"), '/static/flags/Fa%27afafine.png');
  assert.ok(PRONOUNS_PAGE_FLAG_OPTIONS.length > 100);
});
