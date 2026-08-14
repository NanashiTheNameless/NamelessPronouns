ALTER TABLE users ADD COLUMN profile_limit INTEGER;
ALTER TABLE profiles ADD COLUMN avatar_source TEXT;
ALTER TABLE profiles ADD COLUMN avatar_data_uri TEXT;
ALTER TABLE profiles ADD COLUMN owner_user_id TEXT;
UPDATE profiles SET owner_user_id = (
  SELECT w.owner_user_id FROM workspaces w WHERE w.id = profiles.workspace_id
);
DELETE FROM profiles WHERE owner_user_id IS NULL;
DROP INDEX IF EXISTS idx_profiles_workspace;
ALTER TABLE profiles DROP COLUMN workspace_id;
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
