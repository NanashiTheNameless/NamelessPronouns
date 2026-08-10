CREATE TABLE IF NOT EXISTS profile_identity_flags (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS profile_pronoun_preferences (
  profile_id TEXT NOT NULL,
  preference_key TEXT NOT NULL
    CHECK (preference_key IN ('any_pronouns', 'ask_me', 'varies', 'use_name', 'no_pronouns', 'mirror_pronouns', 'use_initials', 'alternate_sets')),
  position INTEGER NOT NULL,
  PRIMARY KEY (profile_id, preference_key),
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
