import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as V from './validation.js';
const TEXT_TYPES = new Set(['exact_field', 'whole_token', 'exact_phrase']);
const URL_TYPES = new Set(['host', 'host_suffix', 'exact_url', 'url_prefix']);
const MODES = new Set(['disabled', 'shadow', 'enforcing']);
const SEVERITIES = new Set(['info', 'warning', 'critical']);
export class ContentRuleError extends Error {}
export function normalizeRuleText(input) {
  if (typeof input !== 'string') throw new ContentRuleError('Text rule match must be a string.');
  const value = input.replace(/ {2,}/g, ' ').trim().toLowerCase();
  if (!value || !/^[a-z0-9 ]+$/.test(value)) {
    throw new ContentRuleError('Text rule match may contain only ASCII letters, digits, and spaces.');
  }
  return value;
}
function canonicalUrl(input) {
  let value;
  try {
    value = new URL(V.httpsUrl(input));
  } catch {
    throw new ContentRuleError('URL rule match must be a valid allowed HTTPS URL.');
  }
  value.hostname = value.hostname.replace(/\.$/, '').toLowerCase();
  return value;
}
function canonicalHost(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ContentRuleError('Hostname rule match is required.');
  }
  let url;
  try {
    url = canonicalUrl(`https://${input}`);
  } catch {
    throw new ContentRuleError('Hostname rule match is invalid.');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new ContentRuleError('Hostname rule must contain only a hostname.');
  }
  return url.hostname;
}
function normalizedPathPrefix(url) {
  if (url.search || url.hash) {
    throw new ContentRuleError('URL prefix rules cannot contain a query or fragment.');
  }
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
  return { origin: url.origin, path };
}
export function compileRule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuleError('Content rule must be an object.');
  }
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw new ContentRuleError('Content rule ID is invalid.');
  if (!TEXT_TYPES.has(input.type) && !URL_TYPES.has(input.type)) {
    throw new ContentRuleError(`Unsupported content rule type for ${id}.`);
  }
  const mode = input.mode ?? 'shadow';
  if (!MODES.has(mode)) throw new ContentRuleError(`Invalid mode for ${id}.`);
  const severity = input.severity ?? 'warning';
  if (!SEVERITIES.has(severity)) throw new ContentRuleError(`Invalid severity for ${id}.`);
  const category = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{2,50}$/.test(category)) throw new ContentRuleError(`Invalid category for ${id}.`);
  const textMatch = TEXT_TYPES.has(input.type) ? normalizeRuleText(input.match) : null;
  if (input.type === 'whole_token' && textMatch.includes(' ')) {
    throw new ContentRuleError(`Whole-token rule ${id} must contain exactly one token.`);
  }
  const hostMatch = ['host', 'host_suffix'].includes(input.type) ? canonicalHost(input.match) : null;
  const urlMatch = ['exact_url', 'url_prefix'].includes(input.type) ? canonicalUrl(input.match) : null;
  const rule = Object.freeze({
    id,
    type: input.type,
    category,
    severity,
    mode,
    explanation: typeof input.explanation === 'string' ? input.explanation : '',
    versionId: typeof input.versionId === 'string' ? input.versionId : null,
    match: textMatch,
    host: hostMatch,
    url: urlMatch,
    matchValue: textMatch ?? hostMatch ?? urlMatch?.toString(),
  });
  if (rule.type === 'url_prefix') normalizedPathPrefix(rule.url);
  return rule;
}
function matchText(rule, input) {
  if (typeof input !== 'string') return false;
  const value = input.replace(/ {2,}/g, ' ').trim().toLowerCase();
  if (!value) return false;
  if (rule.type === 'exact_field') return value === rule.match;
  const leet = { '@': 'a', '4': 'a', '8': 'b', '(': 'c', '{': 'c', '<': 'c', '[': 'c', '3': 'e', '6': 'g', '9': 'g', '#': 'h', '!': 'i', '1': 'i', '|': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't', '2': 'z' };
  const normalizeToken = (token) => [...token]
    .map((character) => leet[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1{2,}/g, '$1');
  const tokens = value.match(/[a-z0-9]+/g) ?? [];
  const chunks = value.split(/\s+/).filter(Boolean);
  const compactTokens = chunks.map((token) => token.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const normalizedTokens = chunks.map(normalizeToken).filter(Boolean);
  const normalizedBoundaryTokens = tokens.map(normalizeToken).filter(Boolean);
  const spacedMatch = rule.match.length >= 4 && normalizedBoundaryTokens.some((token, index) => {
    const window = normalizedBoundaryTokens.slice(index, index + rule.match.length);
    return window.length === rule.match.length && window.every((part) => part.length === 1) && window.join('') === rule.match;
  });
  if (rule.type === 'whole_token') {
    return tokens.includes(rule.match) || compactTokens.includes(rule.match)
      || normalizedTokens.includes(rule.match) || spacedMatch;
  }
  if (rule.type === 'exact_phrase') {
    const phrase = rule.match.split(' ');
    for (const candidateTokens of [tokens, compactTokens, normalizedTokens]) {
      for (let i = 0; i <= candidateTokens.length - phrase.length; i += 1) {
        if (phrase.every((token, offset) => candidateTokens[i + offset] === token)) return true;
      }
    }
  }
  return false;
}
function hostSuffixMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}
function matchUrl(rule, input) {
  let value;
  try {
    value = canonicalUrl(input);
  } catch {
    return false;
  }
  if (rule.type === 'host') return value.hostname === rule.host;
  if (rule.type === 'host_suffix') return hostSuffixMatches(value.hostname, rule.host);
  if (rule.type === 'exact_url') return value.toString() === rule.url.toString();
  if (rule.type === 'url_prefix') {
    const wanted = normalizedPathPrefix(rule.url);
    if (value.origin !== wanted.origin) return false;
    if (wanted.path === '/') return true;
    return value.pathname === wanted.path || value.pathname.startsWith(`${wanted.path}/`);
  }
  return false;
}
export function ruleMatches(rule, value, kind) {
  if (rule.mode === 'disabled') return false;
  if (kind === 'text' && TEXT_TYPES.has(rule.type)) return matchText(rule, value);
  if (kind === 'url' && URL_TYPES.has(rule.type)) return matchUrl(rule, value);
  return false;
}
export function screenContent({ text = {}, urls = {} }, rules) {
  const matches = [];
  for (const rule of rules) {
    for (const [field, value] of Object.entries(TEXT_TYPES.has(rule.type) ? text : urls)) {
      const kind = TEXT_TYPES.has(rule.type) ? 'text' : 'url';
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item, index) => {
        if (ruleMatches(rule, item, kind)) {
          matches.push(Object.freeze({
            ruleId: rule.id,
            ruleVersionId: rule.versionId,
            category: rule.category,
            severity: rule.severity,
            mode: rule.mode,
            field,
            index: Array.isArray(value) ? index : null,
            attemptedValue: item,
          }));
        }
      });
    }
  }
  return matches;
}
function testKind(rule) {
  return TEXT_TYPES.has(rule.type) ? 'text' : 'url';
}
export function compileSeed(seed) {
  if (!seed || seed.schemaVersion !== 1 || !Array.isArray(seed.rules)) {
    throw new ContentRuleError('Content-rule seed must use schemaVersion 1 and contain a rules array.');
  }
  const seen = new Set();
  const rules = seed.rules.map((source) => {
    const rule = compileRule(source);
    if (seen.has(rule.id)) throw new ContentRuleError(`Duplicate content rule ID: ${rule.id}.`);
    seen.add(rule.id);
    for (const value of source.tests?.shouldMatch ?? []) {
      if (!ruleMatches(rule, value, testKind(rule))) {
        throw new ContentRuleError(`Rule ${rule.id} failed a shouldMatch seed test.`);
      }
    }
    for (const value of source.tests?.shouldNotMatch ?? []) {
      if (ruleMatches(rule, value, testKind(rule))) {
        throw new ContentRuleError(`Rule ${rule.id} failed a shouldNotMatch seed test.`);
      }
    }
    return rule;
  });
  return Object.freeze(rules);
}
export function expandBadWordList(source) {
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.groups) || source.groups.length === 0) {
    throw new ContentRuleError('Bad-word list must use schemaVersion 1 and contain a groups array.');
  }
  const seen = new Set();
  const rules = [];
  for (const group of source.groups) {
    if (!group || !Array.isArray(group.terms) || group.terms.length === 0) {
      throw new ContentRuleError('Every bad-word group must contain terms.');
    }
    if (typeof group.category !== 'string' || !/^[a-z0-9_]{2,50}$/.test(group.category)) {
      throw new ContentRuleError('Bad-word group category is invalid.');
    }
    if (!SEVERITIES.has(group.severity)) throw new ContentRuleError('Bad-word group severity is invalid.');
    for (const term of group.terms) {
      const match = normalizeRuleText(term);
      if (seen.has(match)) throw new ContentRuleError(`Duplicate bad-word term: ${match}.`);
      seen.add(match);
      const slug = match.replace(/ /g, '-');
      rules.push({
        id: `badword-${group.category}-${slug}`,
        type: match.includes(' ') ? 'exact_phrase' : 'whole_token',
        category: group.category,
        severity: group.severity,
        match,
        mode: 'shadow',
        explanation: typeof group.explanation === 'string' ? group.explanation : 'Reviewed bad-word vocabulary match. Context requires human review.',
        tests: {
          shouldMatch: [match, `${match.toUpperCase()}!`],
          shouldNotMatch: [`safe${match.replace(/ /g, '')}safe`],
        },
      });
    }
  }
  return rules;
}
export async function loadSeed(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const signatures = new Set(parsed.rules
      .filter((rule) => TEXT_TYPES.has(rule.type))
      .map((rule) => `${rule.category}:${normalizeRuleText(rule.match)}`));
    for (const listName of parsed.wordLists ?? []) {
      if (typeof listName !== 'string' || !/^[A-Za-z0-9._-]+\.json$/.test(listName)) {
        throw new ContentRuleError('Bad-word list path is invalid.');
      }
      const list = JSON.parse(await readFile(resolve(dirname(filePath), listName), 'utf8'));
      for (const rule of expandBadWordList(list)) {
        const signature = `${rule.category}:${rule.match}`;
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        parsed.rules.push(rule);
      }
    }
  } catch (error) {
    if (error instanceof ContentRuleError) throw error;
    throw new ContentRuleError(`Cannot read content-rule seed: ${error.message}`);
  }
  return compileSeed(parsed);
}
export const CONTENT_RULE_TYPES = Object.freeze([...TEXT_TYPES, ...URL_TYPES]);
