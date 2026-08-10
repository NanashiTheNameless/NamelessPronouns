export const PRONOUN_PREFERENCES = Object.freeze([
  Object.freeze({ key: 'any_pronouns', label: 'Any pronouns' }),
  Object.freeze({ key: 'ask_me', label: 'Ask me' }),
  Object.freeze({ key: 'varies', label: 'Varies' }),
  Object.freeze({ key: 'use_name', label: 'Use my name' }),
  Object.freeze({ key: 'no_pronouns', label: 'No pronouns' }),
  Object.freeze({ key: 'mirror_pronouns', label: 'Mirror pronouns' }),
  Object.freeze({ key: 'use_initials', label: 'Use my initials' }),
  Object.freeze({ key: 'alternate_sets', label: 'Alternate between my listed sets' }),
]);

export function pronounPreferenceLabel(key) {
  return PRONOUN_PREFERENCES.find((preference) => preference.key === key)?.label || key;
}
