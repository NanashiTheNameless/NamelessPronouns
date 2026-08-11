import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { contentFieldLabel } from '../src/content-fields.js';
test('content flag fields read as names, not database keys', () => {
  assert.equal(contentFieldLabel('description'), 'About me');
  assert.equal(contentFieldLabel('notes'), 'Identity notes');
  assert.equal(contentFieldLabel('description_links'), 'About me links');
  assert.equal(contentFieldLabel('notes_links'), 'Identity notes links');
  assert.equal(contentFieldLabel('links'), 'Link addresses');
  assert.equal(contentFieldLabel('display_name'), 'Display name');
  assert.equal(contentFieldLabel('pronoun_possessive_determiner'), 'Pronoun possessive determiner');
  assert.equal(contentFieldLabel('word_group_headings'), 'Word group headings');
});
test('an unrecognized field key still reads as words', () => {
  assert.equal(contentFieldLabel('some_future_field'), 'Some future field');
  assert.equal(contentFieldLabel(''), 'Unknown field');
  assert.equal(contentFieldLabel(null), 'Unknown field');
  assert.equal(contentFieldLabel(undefined), 'Unknown field');
});
test('every screened field has a label of its own', async () => {
  const source = await readFile(new URL('../src/routes/profile-editor.js', import.meta.url), 'utf8');
  const block = /function screeningInput\(values\) \{([\s\S]*?)\n\}/.exec(source)[1];
  const keys = [...block.matchAll(/^\s{6}([a-z_]+):/gm)].map((match) => match[1]);
  assert.ok(keys.includes('description_links'), 'the bio link field is screened');
  assert.ok(keys.length >= 15, `every screened key is checked (saw ${keys.length})`);
  for (const key of keys) {
    const label = contentFieldLabel(key);
    assert.notEqual(label, key, `${key} needs a human label`);
    assert.doesNotMatch(label, /_/, `${key} label carries no underscores`);
  }
});
test('the flag pages print the label instead of the key', async () => {
  const flag = {
    id: 'flag-1', policy_category: 'harassment', severity: 'warning', field_type: 'description_links',
    field_index: 0, status: 'warned', createdAt: 'yesterday', mode: 'enforcing', explanation: '',
    ruleId: 'rule-1', canRequest: true,
  };
  const html = await ejs.renderFile(fileURLToPath(new URL('../views/account/content-flags.ejs', import.meta.url)), {
    title: 'Content flags',
    flags: [flag],
    csrfToken: 'csrf',
    user: { email: 'person@example.invalid' },
    contentFieldLabel,
    obfuscateEmail: async (value) => value,
    obfuscateEmails: async (value) => value,
  }, { async: true });
  assert.match(html, /About me links/);
  assert.doesNotMatch(html, /description_links/);
});
