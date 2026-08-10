export function groupProfileWords(groupRows, wordRows) {
  const byGroup = new Map(groupRows.map((row) => [row.id, { heading: row.heading, words: [] }]));
  for (const row of wordRows) {
    byGroup.get(row.group_id)?.words.push({ value: row.value, opinion: row.opinion });
  }
  return [...byGroup.values()];
}
export const PROFILE_WORD_GROUPS_SQL = 'SELECT id, heading FROM profile_word_groups WHERE profile_id = ? ORDER BY position';
export const PROFILE_WORDS_SQL = `SELECT group_id, value, opinion FROM profile_words
  WHERE group_id IN (SELECT id FROM profile_word_groups WHERE profile_id = ?)
  ORDER BY position`;
