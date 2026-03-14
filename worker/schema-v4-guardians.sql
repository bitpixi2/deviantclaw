-- Schema v4: Guardian verification + API key auth
CREATE TABLE IF NOT EXISTS guardians (
  address TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  self_proof_valid INTEGER DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guardians_api_key ON guardians(api_key);

-- Track which agents belong to which guardian
ALTER TABLE agents ADD COLUMN guardian_address TEXT REFERENCES guardians(address);
