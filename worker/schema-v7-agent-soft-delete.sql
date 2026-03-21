-- Schema v7: agent soft-delete
ALTER TABLE agents ADD COLUMN deleted_at TEXT;
ALTER TABLE agents ADD COLUMN deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_agents_deleted_at ON agents(deleted_at);
