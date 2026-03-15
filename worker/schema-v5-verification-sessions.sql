-- Schema v5: verification session state for verify.deviantclaw.art
CREATE TABLE IF NOT EXISTS guardian_verification_sessions (
  address TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  api_key TEXT,
  error TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guardian_verification_sessions_status
  ON guardian_verification_sessions(status);
