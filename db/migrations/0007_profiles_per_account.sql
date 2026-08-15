ALTER TABLE users ADD COLUMN profile_limit INTEGER;
ALTER TABLE profiles ADD COLUMN avatar_source TEXT;
ALTER TABLE profiles ADD COLUMN avatar_data_uri TEXT;
ALTER TABLE profiles ADD COLUMN owner_user_id TEXT;
UPDATE profiles SET owner_user_id = (
  SELECT w.owner_user_id FROM workspaces w WHERE w.id = profiles.workspace_id
);
DELETE FROM profiles WHERE owner_user_id IS NULL;
DROP INDEX IF EXISTS idx_profiles_workspace;

-- Postgres drops the column outright: the foreign key on it goes with it.
-- @postgres
ALTER TABLE profiles DROP COLUMN workspace_id;
-- @end

-- SQLite refuses to drop a column named in a foreign key, so the table is
-- rebuilt. Dropping the old table cascades into every child table, and D1
-- cannot turn foreign keys off, so child rows are copied out and restored.
-- @d1
PRAGMA defer_foreign_keys = ON;
CREATE TABLE mig7_deletion_profile_states AS SELECT * FROM deletion_profile_states;
CREATE TABLE mig7_profile_names AS SELECT * FROM profile_names;
CREATE TABLE mig7_pronoun_sets AS SELECT * FROM pronoun_sets;
CREATE TABLE mig7_profile_links AS SELECT * FROM profile_links;
CREATE TABLE mig7_profile_revisions AS SELECT * FROM profile_revisions;
CREATE TABLE mig7_content_rule_exemptions AS SELECT * FROM content_rule_exemptions;
CREATE TABLE mig7_content_flags AS SELECT * FROM content_flags;
CREATE TABLE mig7_content_suspension_profiles AS SELECT * FROM content_suspension_profiles;
CREATE TABLE mig7_profile_identity_flags AS SELECT * FROM profile_identity_flags;
CREATE TABLE mig7_profile_pronoun_preferences AS SELECT * FROM profile_pronoun_preferences;
CREATE TABLE mig7_profile_word_groups AS SELECT * FROM profile_word_groups;
CREATE TABLE mig7_profile_words AS SELECT * FROM profile_words;
CREATE TABLE profiles_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  username_display TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  theme TEXT NOT NULL DEFAULT 'default',
  published INTEGER NOT NULL DEFAULT 0,
  accepted_revision_id TEXT,
  avatar_source TEXT,
  avatar_data_uri TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);
INSERT INTO profiles_new
  (id, owner_user_id, username, username_display, display_name, description, notes,
   theme, published, accepted_revision_id, avatar_source, avatar_data_uri, created_at, updated_at)
  SELECT id, owner_user_id, username, username_display, display_name, description, notes,
         theme, published, accepted_revision_id, avatar_source, avatar_data_uri, created_at, updated_at
    FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;
INSERT INTO deletion_profile_states SELECT * FROM mig7_deletion_profile_states copy
  WHERE NOT EXISTS (SELECT 1 FROM deletion_profile_states live WHERE live.deletion_id = copy.deletion_id AND live.profile_id = copy.profile_id);
INSERT INTO profile_names SELECT * FROM mig7_profile_names copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_names live WHERE live.id = copy.id);
INSERT INTO pronoun_sets SELECT * FROM mig7_pronoun_sets copy
  WHERE NOT EXISTS (SELECT 1 FROM pronoun_sets live WHERE live.id = copy.id);
INSERT INTO profile_links SELECT * FROM mig7_profile_links copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_links live WHERE live.id = copy.id);
INSERT INTO profile_revisions SELECT * FROM mig7_profile_revisions copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_revisions live WHERE live.id = copy.id);
INSERT INTO content_rule_exemptions SELECT * FROM mig7_content_rule_exemptions copy
  WHERE NOT EXISTS (SELECT 1 FROM content_rule_exemptions live WHERE live.id = copy.id);
INSERT INTO content_flags SELECT * FROM mig7_content_flags copy
  WHERE NOT EXISTS (SELECT 1 FROM content_flags live WHERE live.id = copy.id);
INSERT INTO content_suspension_profiles SELECT * FROM mig7_content_suspension_profiles copy
  WHERE NOT EXISTS (SELECT 1 FROM content_suspension_profiles live WHERE live.suspension_id = copy.suspension_id AND live.profile_id = copy.profile_id);
INSERT INTO profile_identity_flags SELECT * FROM mig7_profile_identity_flags copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_identity_flags live WHERE live.id = copy.id);
INSERT INTO profile_pronoun_preferences SELECT * FROM mig7_profile_pronoun_preferences copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_pronoun_preferences live WHERE live.profile_id = copy.profile_id AND live.preference_key = copy.preference_key);
INSERT INTO profile_word_groups SELECT * FROM mig7_profile_word_groups copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_word_groups live WHERE live.id = copy.id);
INSERT INTO profile_words SELECT * FROM mig7_profile_words copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_words live WHERE live.id = copy.id);
DROP TABLE mig7_deletion_profile_states;
DROP TABLE mig7_profile_names;
DROP TABLE mig7_pronoun_sets;
DROP TABLE mig7_profile_links;
DROP TABLE mig7_profile_revisions;
DROP TABLE mig7_content_rule_exemptions;
DROP TABLE mig7_content_flags;
DROP TABLE mig7_content_suspension_profiles;
DROP TABLE mig7_profile_identity_flags;
DROP TABLE mig7_profile_pronoun_preferences;
DROP TABLE mig7_profile_word_groups;
DROP TABLE mig7_profile_words;
-- @end

CREATE INDEX idx_profiles_owner ON profiles (owner_user_id);
DROP INDEX IF EXISTS idx_workspace_members_user;
DROP TABLE workspace_members;
DROP INDEX IF EXISTS idx_workspaces_owner;
DROP TABLE workspaces;
CREATE TABLE public_username_claims_new (
  username TEXT PRIMARY KEY,
  username_display TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'reserved')),
  pending_user_id TEXT,
  requested_display_name TEXT,
  profile_id TEXT,
  reserved_user_id TEXT,
  reserved_until BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (pending_user_id) REFERENCES users (id),
  FOREIGN KEY (reserved_user_id) REFERENCES users (id)
);
INSERT INTO public_username_claims_new
  (username, username_display, state, pending_user_id, requested_display_name,
   profile_id, reserved_user_id, reserved_until, created_at)
  SELECT username, username_display, state, pending_user_id, requested_display_name,
         profile_id, NULL, NULL, created_at
    FROM public_username_claims;
DROP INDEX IF EXISTS idx_username_claims_user;
DROP TABLE public_username_claims;
ALTER TABLE public_username_claims_new RENAME TO public_username_claims;
CREATE INDEX idx_username_claims_user ON public_username_claims (pending_user_id);
CREATE INDEX idx_username_claims_reserved ON public_username_claims (reserved_user_id, reserved_until);
