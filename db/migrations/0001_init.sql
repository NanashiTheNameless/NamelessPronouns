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
    CHECK (avatar_source IN ('gravatar', 'identicon', 'data')),
  avatar_data_uri TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
CREATE INDEX idx_users_signup_status ON users (signup_status);
CREATE TABLE public_username_claims (
  username TEXT PRIMARY KEY,
  username_display TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active')),
  pending_user_id TEXT,
  requested_display_name TEXT,
  profile_id TEXT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (pending_user_id) REFERENCES users (id)
);
CREATE INDEX idx_username_claims_user ON public_username_claims (pending_user_id);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  restricted INTEGER NOT NULL DEFAULT 0,
  reauth_at BIGINT,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('email', 'totp', 'recovery')),
  code_hash TEXT,
  magic_token_hash TEXT,
  browser_binding_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_login_challenges_user ON login_challenges (user_id);
CREATE INDEX idx_login_challenges_expires ON login_challenges (expires_at);
CREATE TABLE reauth_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);
CREATE INDEX idx_reauth_challenges_session ON reauth_challenges (session_id);
CREATE INDEX idx_reauth_challenges_expires ON reauth_challenges (expires_at);
CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes (user_id);
CREATE TABLE password_reset_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  email_code_hash TEXT NOT NULL,
  second_code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_password_reset_user ON password_reset_challenges (user_id, created_at);
CREATE INDEX idx_password_reset_expires ON password_reset_challenges (expires_at);
CREATE TABLE recovery_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  active_user_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'completed', 'expired')),
  evidence_category TEXT NOT NULL
    CHECK (evidence_category IN ('unverified_intake', 'mailbox_and_offline_record', 'mailbox_and_operator_record', 'owner_emergency')),
  reason TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  decided_by TEXT,
  decision_reason TEXT,
  recovery_token_hash TEXT UNIQUE,
  recovery_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  completed_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (opened_by) REFERENCES users (id),
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
CREATE INDEX idx_recovery_cases_status ON recovery_cases (status, created_at);
CREATE INDEX idx_recovery_cases_expiry ON recovery_cases (recovery_expires_at);
CREATE TABLE deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  active_user_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed', 'held')),
  requested_at BIGINT NOT NULL,
  purge_after BIGINT NOT NULL,
  cancelled_at BIGINT,
  completed_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_deletion_requests_purge ON deletion_requests (status, purge_after);
CREATE TABLE legal_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  review_at BIGINT NOT NULL,
  released_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id)
);
CREATE INDEX idx_legal_holds_user ON legal_holds (user_id, released_at);
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'twofa_email', 'twofa_magic')),
  token_hash TEXT NOT NULL,
  used_at BIGINT,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_email_tokens_user ON email_tokens (user_id);
CREATE INDEX idx_email_tokens_expires ON email_tokens (expires_at);
CREATE TABLE email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_email_change_user ON email_change_requests (user_id, created_at);
CREATE INDEX idx_email_change_expires ON email_change_requests (expires_at);
CREATE TABLE data_export_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  used_at BIGINT,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_data_export_tokens_expires ON data_export_tokens (expires_at);
CREATE TABLE policy_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  age_18_attested_at BIGINT NOT NULL,
  accepted_at BIGINT NOT NULL,
  keyed_ip_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_policy_acceptances_user ON policy_acceptances (user_id);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  subject_user_id TEXT,
  target TEXT,
  ip_hash TEXT,
  detail TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_audit_events_created ON audit_events (created_at);
CREATE INDEX idx_audit_events_type ON audit_events (event_type);
CREATE TABLE bans (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'email', 'domain', 'ip', 'cidr')),
  target_value TEXT NOT NULL,
  target_hash TEXT,
  target_ciphertext TEXT,
  target_nonce TEXT,
  cidr_network TEXT,
  cidr_prefix INTEGER,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'viewing', 'both')),
  reason TEXT,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  lifted_at BIGINT,
  FOREIGN KEY (created_by) REFERENCES users (id)
);
CREATE INDEX idx_bans_target ON bans (target_type, target_value);
CREATE INDEX idx_bans_hash_scope ON bans (target_hash, scope);
CREATE TABLE email_domain_rules (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('disposable', 'allowlist', 'blocklist')),
  source TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE altcha_challenges (
  id TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL UNIQUE,
  binding_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_altcha_expires ON altcha_challenges (expires_at);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  owner_user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id)
);
CREATE INDEX idx_workspaces_owner ON workspaces (owner_user_id);
CREATE TABLE workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at BIGINT NOT NULL,
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_workspace_members_user ON workspace_members (user_id);
CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL,
  invited_by TEXT,
  expires_at BIGINT NOT NULL,
  accepted_at BIGINT,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);
CREATE INDEX idx_workspace_invites_ws ON workspace_invites (workspace_id);
CREATE INDEX idx_workspace_invites_expires ON workspace_invites (expires_at);
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  username_display TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  theme TEXT NOT NULL DEFAULT 'default',
  published INTEGER NOT NULL DEFAULT 0,
  accepted_revision_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);
CREATE INDEX idx_profiles_workspace ON profiles (workspace_id);
CREATE TABLE deletion_profile_states (
  deletion_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  was_published INTEGER NOT NULL,
  PRIMARY KEY (deletion_id, profile_id),
  FOREIGN KEY (deletion_id) REFERENCES deletion_requests (id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE profile_names (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  value TEXT NOT NULL,
  position INTEGER NOT NULL,
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
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE profile_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (profile_id, position),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE profile_revisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  moderation_state TEXT NOT NULL DEFAULT 'accepted'
    CHECK (moderation_state IN ('accepted', 'reverted', 'flagged')),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE INDEX idx_profile_revisions_profile ON profile_revisions (profile_id);
CREATE TABLE content_rules (
  id TEXT PRIMARY KEY,
  current_version_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE content_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  rule_type TEXT NOT NULL
    CHECK (rule_type IN ('exact_field', 'whole_token', 'exact_phrase', 'host', 'host_suffix', 'exact_url', 'url_prefix')),
  match_value TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  mode TEXT NOT NULL CHECK (mode IN ('disabled', 'shadow', 'enforcing')),
  enforce_at BIGINT,
  explanation TEXT,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (rule_id, version),
  FOREIGN KEY (rule_id) REFERENCES content_rules (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id)
);
CREATE INDEX idx_content_rule_versions_rule ON content_rule_versions (rule_id, version);
CREATE INDEX idx_content_rule_versions_mode ON content_rule_versions (mode);
CREATE TABLE content_rule_exemptions (
  id TEXT PRIMARY KEY,
  rule_version_id TEXT NOT NULL,
  field_type TEXT NOT NULL,
  normalized_value_hash TEXT NOT NULL,
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
  FOREIGN KEY (rule_version_id) REFERENCES content_rule_versions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id),
  FOREIGN KEY (revoked_by) REFERENCES users (id)
);
CREATE INDEX idx_content_exemptions_rule ON content_rule_exemptions (rule_version_id, normalized_value_hash);
CREATE INDEX idx_content_exemptions_user ON content_rule_exemptions (user_id);
CREATE INDEX idx_content_exemptions_profile ON content_rule_exemptions (profile_id);
CREATE TABLE content_flags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  rule_version_id TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_index INTEGER NOT NULL DEFAULT -1,
  attempted_ciphertext TEXT NOT NULL,
  attempted_nonce TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  policy_category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'enforcing')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'upheld', 'cleared', 'exempted')),
  auto_suspension_eligible INTEGER NOT NULL DEFAULT 1,
  warned_at BIGINT,
  decided_at BIGINT,
  decided_by TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, idempotency_key_hash, rule_version_id, field_type, field_index),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (rule_version_id) REFERENCES content_rule_versions (id),
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
CREATE INDEX idx_content_flags_status ON content_flags (status, created_at);
CREATE INDEX idx_content_flags_user ON content_flags (user_id, created_at);
CREATE INDEX idx_content_flags_profile ON content_flags (profile_id);
CREATE TABLE content_flag_reviews (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  explanation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'upheld', 'cleared', 'exempted')),
  decided_by TEXT,
  decision_reason TEXT,
  requested_at BIGINT NOT NULL,
  decided_at BIGINT,
  FOREIGN KEY (flag_id) REFERENCES content_flags (id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
CREATE INDEX idx_content_flag_reviews_status ON content_flag_reviews (status, requested_at);
CREATE UNIQUE INDEX idx_content_flag_reviews_flag ON content_flag_reviews (flag_id);
CREATE TABLE content_suspensions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trigger_flag_id TEXT NOT NULL,
  active_user_key TEXT UNIQUE,
  threshold_count INTEGER NOT NULL,
  window_hours INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cleared', 'restored', 'extended', 'terminated', 'banned')),
  decided_by TEXT,
  decision_reason TEXT,
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_flag_id) REFERENCES content_flags (id),
  FOREIGN KEY (decided_by) REFERENCES users (id)
);
CREATE INDEX idx_content_suspensions_user ON content_suspensions (user_id, created_at);
CREATE TABLE content_suspension_profiles (
  suspension_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  was_published INTEGER NOT NULL,
  PRIMARY KEY (suspension_id, profile_id),
  FOREIGN KEY (suspension_id) REFERENCES content_suspensions (id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
