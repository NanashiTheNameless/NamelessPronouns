-- @postgres
ALTER TABLE profile_names DROP CONSTRAINT IF EXISTS profile_names_opinion_check;
ALTER TABLE profile_names ADD CONSTRAINT profile_names_opinion_check
  CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope'));
ALTER TABLE pronoun_sets DROP CONSTRAINT IF EXISTS pronoun_sets_opinion_check;
ALTER TABLE pronoun_sets ADD CONSTRAINT pronoun_sets_opinion_check
  CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope'));
ALTER TABLE profile_pronoun_preferences DROP CONSTRAINT IF EXISTS profile_pronoun_preferences_opinion_check;
ALTER TABLE profile_pronoun_preferences ADD CONSTRAINT profile_pronoun_preferences_opinion_check
  CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope'));
ALTER TABLE profile_words DROP CONSTRAINT IF EXISTS profile_words_opinion_check;
ALTER TABLE profile_words ADD CONSTRAINT profile_words_opinion_check
  CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope'));
-- @end

-- @d1
PRAGMA defer_foreign_keys = ON;
CREATE TABLE mig12_profile_names AS SELECT * FROM profile_names;
CREATE TABLE mig12_pronoun_sets AS SELECT * FROM pronoun_sets;
CREATE TABLE mig12_profile_pronoun_preferences AS SELECT * FROM profile_pronoun_preferences;
CREATE TABLE mig12_profile_words AS SELECT * FROM profile_words;
DROP TABLE profile_names;
DROP TABLE pronoun_sets;
DROP TABLE profile_pronoun_preferences;
DROP TABLE profile_words;
CREATE TABLE profile_names (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  value TEXT NOT NULL,
  position INTEGER NOT NULL,
  opinion TEXT NOT NULL DEFAULT 'yes'
    CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope')),
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE pronoun_sets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  object TEXT NOT NULL,
  possessive_determiner TEXT NOT NULL,
  possessive_pronoun TEXT NOT NULL,
  reflexive TEXT NOT NULL,
  position INTEGER NOT NULL,
  opinion TEXT NOT NULL DEFAULT 'yes'
    CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope')),
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE profile_pronoun_preferences (
  profile_id TEXT NOT NULL,
  preference_key TEXT NOT NULL
    CHECK (preference_key IN ('any_pronouns', 'ask_me', 'varies', 'use_name', 'no_pronouns', 'mirror_pronouns', 'use_initials', 'alternate_sets')),
  position INTEGER NOT NULL,
  opinion TEXT NOT NULL DEFAULT 'yes'
    CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope')),
  PRIMARY KEY (profile_id, preference_key),
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE profile_words (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  value TEXT NOT NULL,
  opinion TEXT NOT NULL DEFAULT 'yes'
    CHECK (opinion IN ('yes', 'jokingly', 'formally', 'close', 'okay', 'nope')),
  position INTEGER NOT NULL,
  UNIQUE (group_id, position),
  FOREIGN KEY (group_id) REFERENCES profile_word_groups (id) ON DELETE CASCADE
);
CREATE INDEX idx_profile_words_group ON profile_words (group_id, position);
INSERT INTO profile_names (id, profile_id, value, position, opinion)
  SELECT id, profile_id, value, position, opinion FROM mig12_profile_names;
INSERT INTO pronoun_sets
  (id, profile_id, subject, object, possessive_determiner, possessive_pronoun, reflexive, position, opinion)
  SELECT id, profile_id, subject, object, possessive_determiner, possessive_pronoun, reflexive, position, opinion
    FROM mig12_pronoun_sets;
INSERT INTO profile_pronoun_preferences (profile_id, preference_key, position, opinion)
  SELECT profile_id, preference_key, position, opinion FROM mig12_profile_pronoun_preferences;
INSERT INTO profile_words (id, group_id, value, opinion, position)
  SELECT id, group_id, value, opinion, position FROM mig12_profile_words;
DROP TABLE mig12_profile_names;
DROP TABLE mig12_pronoun_sets;
DROP TABLE mig12_profile_pronoun_preferences;
DROP TABLE mig12_profile_words;
-- @end
