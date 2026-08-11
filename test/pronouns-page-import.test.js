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
  names: [],
  pronouns: [],
  pronounPreferences: [],
  words: [],
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
      words: [
        { header: 'I am a', values: [{ value: 'person', opinion: 'yes' }, { value: 'lad', opinion: 'no' }] },
        { header: 'Nameless group', values: [] },
        { header: null, values: [{ value: 'orphan', opinion: 'yes' }] },
      ],
      links: ['https://example.com/profile'],
      flags: ['Nonbinary', "Fa'afafine", 'Future Flag'],
      customFlags: [{ value: 'image-id', name: 'Custom' }],
    }],
  }, { locale: 'en', current });
  assert.equal(result.values.displayName, 'Local Name');
  assert.equal(result.values.notes, 'Keep this');
  assert.equal(result.values.published, true);
  assert.deepEqual(result.values.names, [
    { value: 'Alex', opinion: 'yes' },
    { value: 'Not Alex', opinion: 'nope' },
  ]);
  assert.deepEqual(result.values.pronouns[0], {
    subject: 'they', object: 'them', possessiveDeterminer: 'their', possessivePronoun: 'theirs', reflexive: 'themselves',
    opinion: 'yes',
  });
  assert.deepEqual(result.values.pronouns[1], {
    subject: 'he', object: 'him', possessiveDeterminer: 'his', possessivePronoun: 'his', reflexive: 'himself',
    opinion: 'nope',
  });
  assert.deepEqual(result.values.pronouns[2], {
    subject: 'xe', object: 'xem', possessiveDeterminer: 'xyr', possessivePronoun: 'xyrs', reflexive: 'xemself',
    opinion: 'yes',
  });
  assert.deepEqual(result.values.pronouns[3], {
    subject: 'ae', object: 'aer', possessiveDeterminer: 'aer', possessivePronoun: 'aers', reflexive: 'aerself',
    opinion: 'yes',
  });
  assert.deepEqual(result.values.words, [
    {
      heading: 'I am a',
      words: [{ value: 'person', opinion: 'yes' }, { value: 'lad', opinion: 'nope' }],
    },
    { heading: 'Other words', words: [{ value: 'orphan', opinion: 'yes' }] },
  ]);
  assert.equal(result.skippedWordGroups, 1);
  assert.deepEqual(result.values.links, [{ label: 'example com', url: 'https://example.com/profile' }]);
  assert.deepEqual(result.values.flags, ['Nonbinary', "Fa'afafine"]);
  assert.equal(result.skippedPronouns, 1);
  assert.deepEqual(result.values.pronounPreferences, [
    { key: 'any_pronouns', opinion: 'yes' },
    { key: 'ask_me', opinion: 'yes' },
    { key: 'use_name', opinion: 'yes' },
  ]);
  assert.equal(result.skippedCustomFlags, 1);
  assert.equal(result.skippedFlags, 1);
});

test('Pronouns.page opinions map onto the local Yes/Jokingly/Close/Okay/Nope scale', () => {
  const result = mapPronounsPageProfile({
    profiles: [{
      locale: 'en',
      access: true,
      names: [
        { value: 'A', opinion: 'yes' }, { value: 'B', opinion: 'jokingly' },
        { value: 'C', opinion: 'close' }, { value: 'D', opinion: 'meh' },
        { value: 'E', opinion: 'no' }, { value: 'F', opinion: 'something-else' }, 'G',
      ],
      pronouns: [{ value: 'any', opinion: 'jokingly' }],
    }],
  }, { locale: 'en', current });
  assert.deepEqual(result.values.names.map((row) => row.opinion), [
    'yes', 'jokingly', 'close', 'okay', 'nope', 'yes', 'yes',
  ]);
  assert.deepEqual(result.values.pronounPreferences, [{ key: 'any_pronouns', opinion: 'jokingly' }]);
});

test('word groups import in the shape used by the Pronouns.page source', () => {
  const result = mapPronounsPageProfile({
    profiles: [{
      locale: 'en',
      access: true,
      words: [
        {
          header: 'Honorifics',
          values: [
            { value: '[no honorific]', opinion: 'yes' },
            { value: 'mx.', opinion: 'yes' },
            { value: 'mr.', opinion: 'no' },
            { value: 'sai', opinion: 'meh' },
            { value: 'comrade', opinion: 'jokingly' },
          ],
        },
        {
          header: 'Compliments',
          values: [{ value: 'pretty', opinion: 'yes' }, { value: "ma'am", opinion: 'no' }],
        },
      ],
    }],
  }, { locale: 'en', current });
  assert.deepEqual(result.values.words, [
    {
      heading: 'Honorifics',
      words: [
        { value: '[no honorific]', opinion: 'yes' },
        { value: 'mx.', opinion: 'yes' },
        { value: 'mr.', opinion: 'nope' },
        { value: 'sai', opinion: 'okay' },
        { value: 'comrade', opinion: 'jokingly' },
      ],
    },
    {
      heading: 'Compliments',
      words: [{ value: 'pretty', opinion: 'yes' }, { value: "ma'am", opinion: 'nope' }],
    },
  ]);
  assert.equal(result.skippedWordGroups, 0);
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
