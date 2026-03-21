-- DeviantClaw Schema v8: Guardian Delegation
-- Allows guardians to delegate approval rights to their agents

CREATE TABLE IF NOT EXISTS delegations (
  guardian_address TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  max_daily INTEGER DEFAULT 5,
  daily_count INTEGER DEFAULT 0,
  last_reset TEXT,
  signature TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (guardian_address, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_id);
