CREATE TABLE content_rule_exemptions_new (
  id TEXT PRIMARY KEY,
  rule_version_id TEXT,
  field_type TEXT,
  normalized_value TEXT,
  normalized_value_hash TEXT,
  user_id TEXT,
  profile_id TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  self_exemption INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT,
  revoked_at BIGINT,
  revoked_by TEXT,
  revoke_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  updated_by TEXT,
  FOREIGN KEY (rule_version_id) REFERENCES content_rule_versions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id),
  FOREIGN KEY (revoked_by) REFERENCES users (id),
  FOREIGN KEY (updated_by) REFERENCES users (id)
);
INSERT INTO content_rule_exemptions_new
  (id, rule_version_id, field_type, normalized_value, normalized_value_hash, user_id,
   profile_id, reason, created_by, self_exemption, expires_at, revoked_at, revoked_by,
   revoke_reason, created_at, updated_at, updated_by)
  SELECT id, rule_version_id, field_type, NULL, normalized_value_hash, user_id,
         profile_id, reason, created_by, self_exemption, expires_at, revoked_at, revoked_by,
         revoke_reason, created_at, NULL, NULL
    FROM content_rule_exemptions;
DROP INDEX IF EXISTS idx_content_exemptions_rule;
DROP INDEX IF EXISTS idx_content_exemptions_user;
DROP INDEX IF EXISTS idx_content_exemptions_profile;
DROP TABLE content_rule_exemptions;
ALTER TABLE content_rule_exemptions_new RENAME TO content_rule_exemptions;
CREATE INDEX idx_content_exemptions_rule ON content_rule_exemptions (rule_version_id, normalized_value);
CREATE INDEX idx_content_exemptions_hash ON content_rule_exemptions (normalized_value_hash);
CREATE INDEX idx_content_exemptions_user ON content_rule_exemptions (user_id);
CREATE INDEX idx_content_exemptions_profile ON content_rule_exemptions (profile_id);
