import { z } from 'zod';
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'staff', 'owner', 'support', 'moderator',
  'about', 'contact', 'terms', 'privacy', 'legal', 'login', 'logout', 'signup', 'register',
  'account', 'dashboard', 'settings', 'profiles', 'profile', 'workspaces', 'workspace',
  'u', 'user', 'users', 'api', 'static', 'assets', 'healthz', 'readyz', 'consent', 'recover',
  'verify-email', 'null', 'undefined', 'anonymous', 'someone', 'something', 'unknown', 'else',
  'everyone', 'everything', 'nobody', 'nothing', 'epoch',
  'nan', 'localhost', 'true', 'false', 'void', 'infinity', 'me', 'self',
]);
export class ValidationError extends Error {}
const DISPLAY_CHARACTER = /[A-Za-z0-9 -]/;
const PROSE_CHARACTER = /[\x20-\x7E\n]/;
const INVISIBLE = /[\p{C}\p{M}\p{Z}]/u;
function characterLabel(character) {
  const hex = character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  return INVISIBLE.test(character) ? `U+${hex}` : `"${character}" (U+${hex})`;
}
export function illegalCharacters(value, allowed) {
  const found = [];
  for (const character of String(value)) {
    if (allowed.test(character) || found.includes(character)) continue;
    found.push(character);
  }
  return found;
}
function illegalCharacterNotice(value, allowed) {
  const found = illegalCharacters(value, allowed);
  if (found.length === 0) return '';
  const shown = found.slice(0, 8).map(characterLabel).join(', ');
  const overflow = found.length > 8 ? `, and ${found.length - 8} more` : '';
  return ` Remove ${found.length === 1 ? 'this character' : 'these characters'}: ${shown}${overflow}.`;
}
export function normalizeText(input) {
  if (typeof input !== 'string') throw new ValidationError('Text is required.');
  return input.replace(/ {2,}/g, ' ').trim();
}
export function displayText(input, { field = 'value', min = 1, max = 200 } = {}) {
  const value = normalizeText(input);
  if (value.length < min) {
    throw new ValidationError(min > 1 ? `${field} must be at least ${min} characters.` : `${field} is required.`);
  }
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  if (!/^[A-Za-z0-9 -]+$/.test(value)) {
    throw new ValidationError(
      `${field} may contain only letters, numbers, spaces, and dashes.${illegalCharacterNotice(value, DISPLAY_CHARACTER)}`,
    );
  }
  return value;
}
export function proseText(input, { field = 'value', min = 1, max = 1000 } = {}) {
  if (typeof input !== 'string') throw new ValidationError(`${field} is required.`);
  const value = input
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (value.length < min) {
    throw new ValidationError(min > 1 ? `${field} must be at least ${min} characters.` : `${field} is required.`);
  }
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  if (!/^[\x20-\x7E\n]+$/.test(value)) {
    throw new ValidationError(
      `${field} may contain only standard English letters, numbers, punctuation, and spaces.`
      + illegalCharacterNotice(value, PROSE_CHARACTER),
    );
  }
  return value;
}
export function markdownText(input, { field = 'value', min = 1, max = 1000 } = {}) {
  if (typeof input !== 'string') throw new ValidationError(`${field} is required.`);
  const value = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replaceAll('\t', '  ').replace(/[^\S\n]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (value.length < min) {
    throw new ValidationError(min > 1 ? `${field} must be at least ${min} characters.` : `${field} is required.`);
  }
  if (value.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  if (!/^[\x20-\x7E\n]+$/.test(value)) {
    throw new ValidationError(
      `${field} may contain only standard English letters, numbers, punctuation, and spaces.`
      + illegalCharacterNotice(value, PROSE_CHARACTER),
    );
  }
  return value;
}
export function reasonText(input, { field = 'reason', min = 3, max = 300 } = {}) {
  return proseText(input, { field, min, max });
}
export function username(input, { field = 'username' } = {}) {
  if (typeof input !== 'string') throw new ValidationError(`${field} is required.`);
  const display = input.trim();
  if (display.length < 3 || display.length > 32 || !/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(display)) {
    throw new ValidationError(`${field} must be 3-32 letters, digits, or single internal dashes.`);
  }
  const key = display.toLowerCase();
  if (RESERVED_USERNAMES.has(key)) throw new ValidationError(`${field} is reserved.`);
  return { key, display };
}
export function email(input, { field = 'email' } = {}) {
  if (typeof input !== 'string') throw new ValidationError(`${field} is required.`);
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new ValidationError(`${field} is not a valid address.`);
  }
  return value;
}
const ALLOWED_URL_PORTS = new Set(['', '443']);
export function httpsUrl(input, { field = 'url', max = 2048 } = {}) {
  if (typeof input !== 'string') throw new ValidationError(`${field} is required.`);
  const raw = input.trim();
  if (raw.length === 0 || raw.length > max) throw new ValidationError(`${field} is required.`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`${field} is not a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new ValidationError(`${field} must be an HTTPS URL.`);
  if (url.username || url.password) throw new ValidationError(`${field} must not contain credentials.`);
  if (!ALLOWED_URL_PORTS.has(url.port)) throw new ValidationError(`${field} uses a disallowed port.`);
  return url.toString();
}
export { RESERVED_USERNAMES, z };
