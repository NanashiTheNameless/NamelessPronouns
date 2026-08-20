-- @postgres
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_source_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_source_check
  CHECK (avatar_source IN ('gravatar', 'libravatar', 'identicon', 'data'));
-- @end

-- @d1
PRAGMA defer_foreign_keys = ON;
CREATE TABLE mig11_users AS SELECT * FROM users;
CREATE TABLE mig11_profiles AS SELECT * FROM profiles;
CREATE TABLE mig11_profile_names AS SELECT * FROM profile_names;
CREATE TABLE mig11_pronoun_sets AS SELECT * FROM pronoun_sets;
CREATE TABLE mig11_profile_links AS SELECT * FROM profile_links;
CREATE TABLE mig11_profile_identity_flags AS SELECT * FROM profile_identity_flags;
CREATE TABLE mig11_profile_pronoun_preferences AS SELECT * FROM profile_pronoun_preferences;
CREATE TABLE mig11_profile_word_groups AS SELECT * FROM profile_word_groups;
CREATE TABLE mig11_profile_words AS SELECT * FROM profile_words;
CREATE TABLE mig11_profile_revisions AS SELECT * FROM profile_revisions;
CREATE TABLE mig11_sessions AS SELECT * FROM sessions;
CREATE TABLE mig11_reauth_challenges AS SELECT * FROM reauth_challenges;
CREATE TABLE mig11_login_challenges AS SELECT * FROM login_challenges;
CREATE TABLE mig11_recovery_codes AS SELECT * FROM recovery_codes;
CREATE TABLE mig11_recovery_cases AS SELECT * FROM recovery_cases;
CREATE TABLE mig11_password_reset_challenges AS SELECT * FROM password_reset_challenges;
CREATE TABLE mig11_email_tokens AS SELECT * FROM email_tokens;
CREATE TABLE mig11_email_change_requests AS SELECT * FROM email_change_requests;
CREATE TABLE mig11_data_export_tokens AS SELECT * FROM data_export_tokens;
CREATE TABLE mig11_policy_acceptances AS SELECT * FROM policy_acceptances;
CREATE TABLE mig11_legal_holds AS SELECT * FROM legal_holds;
CREATE TABLE mig11_deletion_requests AS SELECT * FROM deletion_requests;
CREATE TABLE mig11_deletion_profile_states AS SELECT * FROM deletion_profile_states;
CREATE TABLE mig11_content_rule_exemptions AS SELECT * FROM content_rule_exemptions;
CREATE TABLE mig11_content_flags AS SELECT * FROM content_flags;
CREATE TABLE mig11_content_flag_reviews AS SELECT * FROM content_flag_reviews;
CREATE TABLE mig11_content_suspensions AS SELECT * FROM content_suspensions;
CREATE TABLE mig11_content_suspension_profiles AS SELECT * FROM content_suspension_profiles;
DROP TABLE users;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_hash_version INTEGER NOT NULL DEFAULT 1,
  email_verified_at BIGINT,
  signup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (signup_status IN ('pending', 'approved', 'denied', 'terminated')),
  requested_profile_username TEXT,
  requested_profile_username_display TEXT,
  requested_display_name TEXT,
  request_note TEXT,
  requested_at BIGINT,
  decided_at BIGINT,
  decided_by TEXT,
  decision_note TEXT,
  staff_role TEXT NOT NULL DEFAULT 'none'
    CHECK (staff_role IN ('none', 'support', 'moderator', 'administrator', 'owner')),
  twofa_method TEXT NOT NULL DEFAULT 'email'
    CHECK (twofa_method IN ('email', 'totp')),
  totp_secret_ciphertext TEXT,
  totp_secret_nonce TEXT,
  totp_key_version INTEGER,
  totp_confirmed_at BIGINT,
  totp_last_step BIGINT,
  email_login_disabled INTEGER NOT NULL DEFAULT 0,
  avatar_source TEXT NOT NULL DEFAULT 'identicon'
    CHECK (avatar_source IN ('gravatar', 'libravatar', 'identicon', 'data')),
  avatar_data_uri TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  decision_reason_public TEXT,
  signup_ip_prefix_hash TEXT,
  profile_limit INTEGER,
  password_reset_required_at BIGINT,
  password_reset_required_reason TEXT,
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
INSERT INTO users
  (id, email, password_hash, password_hash_version, email_verified_at, signup_status,
   requested_profile_username, requested_profile_username_display, requested_display_name,
   request_note, requested_at, decided_at, decided_by, decision_note, staff_role, twofa_method,
   totp_secret_ciphertext, totp_secret_nonce, totp_key_version, totp_confirmed_at, totp_last_step,
   email_login_disabled, avatar_source, avatar_data_uri, created_at, updated_at,
   decision_reason_public, signup_ip_prefix_hash, profile_limit,
   password_reset_required_at, password_reset_required_reason)
  SELECT id, email, password_hash, password_hash_version, email_verified_at, signup_status,
         requested_profile_username, requested_profile_username_display, requested_display_name,
         request_note, requested_at, decided_at, decided_by, decision_note, staff_role, twofa_method,
         totp_secret_ciphertext, totp_secret_nonce, totp_key_version, totp_confirmed_at, totp_last_step,
         email_login_disabled, avatar_source, avatar_data_uri, created_at, updated_at,
         decision_reason_public, signup_ip_prefix_hash, profile_limit,
         password_reset_required_at, password_reset_required_reason
    FROM mig11_users;
CREATE INDEX idx_users_signup_status ON users (signup_status);
CREATE INDEX idx_users_signup_ip_prefix ON users (signup_ip_prefix_hash);
CREATE INDEX idx_users_password_reset_required ON users (password_reset_required_at);
INSERT INTO profiles SELECT * FROM mig11_profiles copy
  WHERE NOT EXISTS (SELECT 1 FROM profiles live WHERE live.id = copy.id);
INSERT INTO profile_names SELECT * FROM mig11_profile_names copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_names live WHERE live.id = copy.id);
INSERT INTO pronoun_sets SELECT * FROM mig11_pronoun_sets copy
  WHERE NOT EXISTS (SELECT 1 FROM pronoun_sets live WHERE live.id = copy.id);
INSERT INTO profile_links SELECT * FROM mig11_profile_links copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_links live WHERE live.id = copy.id);
INSERT INTO profile_identity_flags SELECT * FROM mig11_profile_identity_flags copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_identity_flags live WHERE live.id = copy.id);
INSERT INTO profile_pronoun_preferences SELECT * FROM mig11_profile_pronoun_preferences copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_pronoun_preferences live
                     WHERE live.profile_id = copy.profile_id AND live.preference_key = copy.preference_key);
INSERT INTO profile_word_groups SELECT * FROM mig11_profile_word_groups copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_word_groups live WHERE live.id = copy.id);
INSERT INTO profile_words SELECT * FROM mig11_profile_words copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_words live WHERE live.id = copy.id);
INSERT INTO profile_revisions SELECT * FROM mig11_profile_revisions copy
  WHERE NOT EXISTS (SELECT 1 FROM profile_revisions live WHERE live.id = copy.id);
INSERT INTO sessions SELECT * FROM mig11_sessions copy
  WHERE NOT EXISTS (SELECT 1 FROM sessions live WHERE live.id = copy.id);
INSERT INTO reauth_challenges SELECT * FROM mig11_reauth_challenges copy
  WHERE NOT EXISTS (SELECT 1 FROM reauth_challenges live WHERE live.id = copy.id);
INSERT INTO login_challenges SELECT * FROM mig11_login_challenges copy
  WHERE NOT EXISTS (SELECT 1 FROM login_challenges live WHERE live.id = copy.id);
INSERT INTO recovery_codes SELECT * FROM mig11_recovery_codes copy
  WHERE NOT EXISTS (SELECT 1 FROM recovery_codes live WHERE live.id = copy.id);
INSERT INTO recovery_cases SELECT * FROM mig11_recovery_cases copy
  WHERE NOT EXISTS (SELECT 1 FROM recovery_cases live WHERE live.id = copy.id);
INSERT INTO password_reset_challenges SELECT * FROM mig11_password_reset_challenges copy
  WHERE NOT EXISTS (SELECT 1 FROM password_reset_challenges live WHERE live.id = copy.id);
INSERT INTO email_tokens SELECT * FROM mig11_email_tokens copy
  WHERE NOT EXISTS (SELECT 1 FROM email_tokens live WHERE live.id = copy.id);
INSERT INTO email_change_requests SELECT * FROM mig11_email_change_requests copy
  WHERE NOT EXISTS (SELECT 1 FROM email_change_requests live WHERE live.id = copy.id);
INSERT INTO data_export_tokens SELECT * FROM mig11_data_export_tokens copy
  WHERE NOT EXISTS (SELECT 1 FROM data_export_tokens live WHERE live.id = copy.id);
INSERT INTO policy_acceptances SELECT * FROM mig11_policy_acceptances copy
  WHERE NOT EXISTS (SELECT 1 FROM policy_acceptances live WHERE live.id = copy.id);
INSERT INTO legal_holds SELECT * FROM mig11_legal_holds copy
  WHERE NOT EXISTS (SELECT 1 FROM legal_holds live WHERE live.id = copy.id);
INSERT INTO deletion_requests SELECT * FROM mig11_deletion_requests copy
  WHERE NOT EXISTS (SELECT 1 FROM deletion_requests live WHERE live.id = copy.id);
INSERT INTO deletion_profile_states SELECT * FROM mig11_deletion_profile_states copy
  WHERE NOT EXISTS (SELECT 1 FROM deletion_profile_states live
                     WHERE live.deletion_id = copy.deletion_id AND live.profile_id = copy.profile_id);
INSERT INTO content_rule_exemptions SELECT * FROM mig11_content_rule_exemptions copy
  WHERE NOT EXISTS (SELECT 1 FROM content_rule_exemptions live WHERE live.id = copy.id);
INSERT INTO content_flags SELECT * FROM mig11_content_flags copy
  WHERE NOT EXISTS (SELECT 1 FROM content_flags live WHERE live.id = copy.id);
INSERT INTO content_flag_reviews SELECT * FROM mig11_content_flag_reviews copy
  WHERE NOT EXISTS (SELECT 1 FROM content_flag_reviews live WHERE live.id = copy.id);
INSERT INTO content_suspensions SELECT * FROM mig11_content_suspensions copy
  WHERE NOT EXISTS (SELECT 1 FROM content_suspensions live WHERE live.id = copy.id);
INSERT INTO content_suspension_profiles SELECT * FROM mig11_content_suspension_profiles copy
  WHERE NOT EXISTS (SELECT 1 FROM content_suspension_profiles live
                     WHERE live.suspension_id = copy.suspension_id AND live.profile_id = copy.profile_id);
DROP TABLE mig11_users;
DROP TABLE mig11_profiles;
DROP TABLE mig11_profile_names;
DROP TABLE mig11_pronoun_sets;
DROP TABLE mig11_profile_links;
DROP TABLE mig11_profile_identity_flags;
DROP TABLE mig11_profile_pronoun_preferences;
DROP TABLE mig11_profile_word_groups;
DROP TABLE mig11_profile_words;
DROP TABLE mig11_profile_revisions;
DROP TABLE mig11_sessions;
DROP TABLE mig11_reauth_challenges;
DROP TABLE mig11_login_challenges;
DROP TABLE mig11_recovery_codes;
DROP TABLE mig11_recovery_cases;
DROP TABLE mig11_password_reset_challenges;
DROP TABLE mig11_email_tokens;
DROP TABLE mig11_email_change_requests;
DROP TABLE mig11_data_export_tokens;
DROP TABLE mig11_policy_acceptances;
DROP TABLE mig11_legal_holds;
DROP TABLE mig11_deletion_requests;
DROP TABLE mig11_deletion_profile_states;
DROP TABLE mig11_content_rule_exemptions;
DROP TABLE mig11_content_flags;
DROP TABLE mig11_content_flag_reviews;
DROP TABLE mig11_content_suspensions;
DROP TABLE mig11_content_suspension_profiles;
-- @end
