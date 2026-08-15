DELETE FROM profiles WHERE owner_user_id IS NULL;

-- @postgres
ALTER TABLE profiles ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE profiles ADD CONSTRAINT profiles_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE;
-- @end
