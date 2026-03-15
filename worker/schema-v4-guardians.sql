-- Schema v4: Guardian verification + API key auth
CREATE TABLE IF NOT EXISTS guardians (
  address TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  self_proof_valid INTEGER DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guardians_api_key ON guardians(api_key);
-- guardian_address is added in schema-v2.sql for agent ownership + approvals
