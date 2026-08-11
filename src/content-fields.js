const LABELS = Object.freeze({
  display_name: 'Display name',
  description: 'About me',
  notes: 'Identity notes',
  names: 'Names',
  word_group_headings: 'Word group headings',
  words: 'Words',
  pronoun_subject: 'Pronoun subject form',
  pronoun_object: 'Pronoun object form',
  pronoun_possessive_determiner: 'Pronoun possessive determiner',
  pronoun_possessive_pronoun: 'Pronoun possessive form',
  pronoun_reflexive: 'Pronoun reflexive form',
  link_labels: 'Link labels',
  links: 'Link addresses',
  description_links: 'About me links',
  notes_links: 'Identity notes links',
});
export function contentFieldLabel(key) {
  const field = String(key ?? '').trim();
  if (!field) return 'Unknown field';
  if (LABELS[field]) return LABELS[field];
  const words = field.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export { LABELS as CONTENT_FIELD_LABELS };
