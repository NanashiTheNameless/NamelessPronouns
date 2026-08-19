ALTER TABLE users ADD COLUMN password_reset_required_at BIGINT;
ALTER TABLE users ADD COLUMN password_reset_required_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_required ON users (password_reset_required_at);
CREATE TABLE IF NOT EXISTS password_reset_mandates (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_by TEXT,
  accounts INTEGER NOT NULL DEFAULT 0,
  sessions_revoked INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  notify_failed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  FOREIGN KEY (created_by) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_password_reset_mandates_created_at ON password_reset_mandates (created_at);
