export const OPINIONS = Object.freeze([
  Object.freeze({ key: 'yes', label: 'Yes' }),
  Object.freeze({ key: 'okay', label: 'Okay' }),
  Object.freeze({ key: 'close', label: "Only if we're close" }),
  Object.freeze({ key: 'jokingly', label: 'Jokingly' }),
  Object.freeze({ key: 'nope', label: 'Nope' }),
]);
export const DEFAULT_OPINION = 'yes';
export const OPINION_KEYS = Object.freeze(OPINIONS.map((opinion) => opinion.key));
const KEY_SET = new Set(OPINION_KEYS);
const IMPORT_ALIASES = Object.freeze({
  yes: 'yes',
  favourite: 'yes',
  favorite: 'yes',
  jokingly: 'jokingly',
  close: 'close',
  friends: 'close',
  meh: 'okay',
  okay: 'okay',
  ok: 'okay',
  no: 'nope',
  nope: 'nope',
});
export function isOpinion(value) {
  return KEY_SET.has(value);
}
export function normalizeOpinion(value) {
  return KEY_SET.has(value) ? value : DEFAULT_OPINION;
}
export function opinionLabel(key) {
  return OPINIONS.find((opinion) => opinion.key === key)?.label
    || OPINIONS.find((opinion) => opinion.key === DEFAULT_OPINION).label;
}
export function importedOpinion(value) {
  if (value == null) return DEFAULT_OPINION;
  return IMPORT_ALIASES[String(value).trim().toLowerCase()] || DEFAULT_OPINION;
}
