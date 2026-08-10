import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  ContentRuleError,
  compileRule,
  expandBadWordList,
  loadSeed,
  ruleMatches,
  screenContent,
} from '../src/content-rules.js';
import { importMissingSeedRules, seedInsertStatements } from '../src/content-rule-store.js';
test('content rules: whole-token matching avoids substrings', () => {
  const rule = compileRule({
    id: 'blocked-token', type: 'whole_token', category: 'abuse', severity: 'warning', mode: 'enforcing', match: 'badword',
  });
  assert.equal(ruleMatches(rule, 'a badword bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a badword! bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a\nbadword\nbio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a bad.word bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a b4dw0rd bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a baaadddword bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'a b a d w o r d bio', 'text'), true);
  assert.equal(ruleMatches(rule, 'notbadwordinside', 'text'), false);
  assert.equal(ruleMatches(rule, 'not-badwordinside', 'text'), false);
  assert.equal(ruleMatches(rule, 'b4dw0rdinside', 'text'), false);
  assert.equal(ruleMatches(rule, 'BadWord', 'text'), true);
});
test('content rules: exact phrase requires consecutive complete tokens', () => {
  const rule = compileRule({
    id: 'blocked-phrase', type: 'exact_phrase', category: 'abuse', severity: 'warning', mode: 'enforcing', match: 'bad phrase',
  });
  assert.equal(ruleMatches(rule, 'this bad phrase appears', 'text'), true);
  assert.equal(ruleMatches(rule, 'this bad, phrase appears', 'text'), true);
  assert.equal(ruleMatches(rule, 'this bad\nphrase appears', 'text'), true);
  assert.equal(ruleMatches(rule, 'this b4d phr4s3 appears', 'text'), true);
  assert.equal(ruleMatches(rule, 'this bad other phrase appears', 'text'), false);
  assert.equal(ruleMatches(rule, 'this bad phrases appears', 'text'), false);
});
test('content rules: common symbol-only leetspeak is normalized', () => {
  const rule = compileRule({
    id: 'leet-token', type: 'whole_token', category: 'profanity', severity: 'warning', mode: 'shadow', match: 'shit',
  });
  assert.equal(ruleMatches(rule, '$#!+', 'text'), true);
  assert.equal(ruleMatches(rule, 'sh111t', 'text'), true);
  assert.equal(ruleMatches(rule, 'shirts', 'text'), false);
});
test('content rules: exact host and suffix use hostname-label boundaries', () => {
  const exact = compileRule({
    id: 'blocked-host', type: 'host', category: 'adult', severity: 'critical', mode: 'enforcing', match: 'blocked.example',
  });
  const suffix = compileRule({
    id: 'blocked-suffix', type: 'host_suffix', category: 'adult', severity: 'critical', mode: 'enforcing', match: 'blocked.example',
  });
  assert.equal(ruleMatches(exact, 'https://blocked.example/path', 'url'), true);
  assert.equal(ruleMatches(exact, 'https://sub.blocked.example/path', 'url'), false);
  assert.equal(ruleMatches(suffix, 'https://sub.blocked.example/path', 'url'), true);
  assert.equal(ruleMatches(suffix, 'https://notblocked.example/path', 'url'), false);
});
test('content rules: URL prefix respects path boundaries', () => {
  const rule = compileRule({
    id: 'blocked-path', type: 'url_prefix', category: 'adult', severity: 'critical', mode: 'enforcing', match: 'https://example.com/bad',
  });
  assert.equal(ruleMatches(rule, 'https://example.com/bad', 'url'), true);
  assert.equal(ruleMatches(rule, 'https://example.com/bad/page?q=x', 'url'), true);
  assert.equal(ruleMatches(rule, 'https://example.com/badly', 'url'), false);
  assert.equal(ruleMatches(rule, 'https://other.example/bad', 'url'), false);
});
test('content rules: screenContent reports field and list position', () => {
  const rules = [compileRule({
    id: 'blocked-token', type: 'whole_token', category: 'abuse', severity: 'warning', mode: 'enforcing', match: 'badword',
  })];
  assert.deepEqual(screenContent({ text: { pronouns: ['safe', 'badword'] } }, rules), [{
    ruleId: 'blocked-token', ruleVersionId: null, category: 'abuse', severity: 'warning', mode: 'enforcing', field: 'pronouns', index: 1, attemptedValue: 'badword',
  }]);
});
test('content rules: disabled rules do not match', () => {
  const rule = compileRule({
    id: 'disabled-rule', type: 'whole_token', category: 'abuse', severity: 'warning', mode: 'disabled', match: 'badword',
  });
  assert.equal(ruleMatches(rule, 'badword', 'text'), false);
});
test('content rules: malformed or duplicate rules fail closed', () => {
  assert.throws(() => compileRule({ id: 'bad', type: 'substring', category: 'abuse', match: 'x' }), ContentRuleError);
  assert.throws(() => compileRule({ id: 'bad host', type: 'host', category: 'abuse', match: 'example.com' }), ContentRuleError);
  assert.throws(() => compileRule({ id: 'bad-token', type: 'whole_token', category: 'abuse', match: 'two words' }), ContentRuleError);
});
test('content rules: repository seed compiles and passes its regression cases', async () => {
  const seedPath = fileURLToPath(new URL('../config/content-rules.json', import.meta.url));
  const rules = await loadSeed(seedPath);
  assert.ok(rules.length >= 1000);
  assert.equal(rules.every((rule) => rule.mode === 'shadow'), true);
  assert.ok(rules.filter((rule) => rule.category === 'adult').length >= 6);
  assert.ok(rules.filter((rule) => rule.category === 'hate').length >= 170);
  assert.ok(rules.filter((rule) => rule.category === 'profanity').length >= 110);
  assert.ok(rules.filter((rule) => rule.category === 'harassment').length >= 80);
  assert.ok(rules.filter((rule) => rule.category === 'threat').length >= 10);
  assert.ok(rules.filter((rule) => rule.category === 'sexual').length >= 140);
  assert.ok(rules.filter((rule) => rule.category === 'regional_profanity').length >= 80);
  assert.ok(rules.filter((rule) => rule.category === 'gaming_harassment').length >= 60);
  assert.ok(rules.filter((rule) => rule.category === 'sexual_solicitation').length >= 60);
  assert.ok(rules.filter((rule) => rule.category === 'extremism').length >= 60);
  assert.ok(rules.filter((rule) => rule.category === 'scam').length >= 90);
  assert.ok(rules.filter((rule) => rule.category === 'spam').length >= 40);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
});
test('content rules: bad-word vocabulary rejects duplicate and malformed groups', () => {
  assert.throws(() => expandBadWordList({ schemaVersion: 1, groups: [] }), ContentRuleError);
  assert.throws(() => expandBadWordList({
    schemaVersion: 1,
    groups: [{ category: 'profanity', severity: 'warning', terms: ['duplicate', 'DUPLICATE'] }],
  }), /Duplicate bad-word term/);
});
test('content rules: seed statements persist the normalized version', () => {
  const rule = compileRule({
    id: 'seed-rule', type: 'exact_phrase', category: 'abuse', severity: 'warning', mode: 'shadow', match: 'Bad   Phrase',
  });
  const statements = seedInsertStatements(rule, { now: 123, versionId: 'version-1' });
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].params, ['seed-rule', 'version-1', 123, 123]);
  assert.equal(statements[1].params[3], 'bad phrase');
});
test('content rules: seed import skips existing IDs without overwriting them', async () => {
  const existing = new Set(['existing-rule']);
  const batches = [];
  const database = {
    async query(_sql, params) {
      return { rows: existing.has(params[0]) ? [{ id: params[0] }] : [] };
    },
    async batch(statements) {
      batches.push(statements);
      existing.add(statements[0].params[0]);
    },
  };
  const rules = [
    compileRule({ id: 'existing-rule', type: 'whole_token', category: 'abuse', severity: 'warning', mode: 'shadow', match: 'first' }),
    compileRule({ id: 'new-rule', type: 'whole_token', category: 'abuse', severity: 'warning', mode: 'shadow', match: 'second' }),
  ];
  const result = await importMissingSeedRules(rules, { database });
  assert.deepEqual(result, { imported: ['new-rule'], skipped: ['existing-rule'] });
  assert.equal(batches.length, 1);
});
