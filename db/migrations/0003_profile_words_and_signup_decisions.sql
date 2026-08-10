ALTER TABLE profile_names ADD COLUMN opinion TEXT NOT NULL DEFAULT 'yes'
  CHECK (opinion IN ('yes', 'jokingly', 'close', 'okay', 'nope'));
ALTER TABLE pronoun_sets ADD COLUMN opinion TEXT NOT NULL DEFAULT 'yes'
  CHECK (opinion IN ('yes', 'jokingly', 'close', 'okay', 'nope'));
ALTER TABLE profile_pronoun_preferences ADD COLUMN opinion TEXT NOT NULL DEFAULT 'yes'
  CHECK (opinion IN ('yes', 'jokingly', 'close', 'okay', 'nope'));
CREATE TABLE IF NOT EXISTS profile_word_groups (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  heading TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS profile_words (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  value TEXT NOT NULL,
  opinion TEXT NOT NULL DEFAULT 'yes'
    CHECK (opinion IN ('yes', 'jokingly', 'close', 'okay', 'nope')),
  position INTEGER NOT NULL,
  UNIQUE (group_id, position),
  FOREIGN KEY (group_id) REFERENCES profile_word_groups (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_profile_word_groups_profile ON profile_word_groups (profile_id, position);
CREATE INDEX IF NOT EXISTS idx_profile_words_group ON profile_words (group_id, position);
ALTER TABLE users ADD COLUMN decision_reason_public TEXT;
ALTER TABLE users ADD COLUMN signup_ip_prefix_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_users_signup_ip_prefix ON users (signup_ip_prefix_hash);
