ALTER TABLE profiles ADD COLUMN staff_badge_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
UPDATE profiles SET is_primary = 1 WHERE NOT EXISTS (
  SELECT 1 FROM profiles other
   WHERE other.owner_user_id = profiles.owner_user_id
     AND (other.created_at < profiles.created_at
          OR (other.created_at = profiles.created_at AND other.id < profiles.id))
);
CREATE INDEX idx_profiles_primary ON profiles (owner_user_id, is_primary);
