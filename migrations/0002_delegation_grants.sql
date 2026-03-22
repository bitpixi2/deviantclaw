-- DeviantClaw Schema v9: Real MetaMask delegation grants
-- Adds durable grant storage and redemption bookkeeping to the existing delegations table.

ALTER TABLE delegations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE delegations ADD COLUMN delegate_target TEXT;
ALTER TABLE delegations ADD COLUMN permission_context TEXT;
ALTER TABLE delegations ADD COLUMN grant_payload TEXT;
ALTER TABLE delegations ADD COLUMN grant_signature TEXT;
ALTER TABLE delegations ADD COLUMN grant_hash TEXT;
ALTER TABLE delegations ADD COLUMN enable_tx_hash TEXT;
ALTER TABLE delegations ADD COLUMN disable_tx_hash TEXT;
ALTER TABLE delegations ADD COLUMN granted_at TEXT;
ALTER TABLE delegations ADD COLUMN updated_at TEXT;
ALTER TABLE delegations ADD COLUMN current_redemption_piece_id TEXT;
ALTER TABLE delegations ADD COLUMN last_redeemed_at TEXT;
ALTER TABLE delegations ADD COLUMN last_redeemed_piece_id TEXT;
ALTER TABLE delegations ADD COLUMN last_redemption_tx_hash TEXT;
ALTER TABLE delegations ADD COLUMN last_error TEXT;

UPDATE delegations
SET status = CASE WHEN enabled = 1 THEN 'active' ELSE 'revoked' END,
    updated_at = COALESCE(updated_at, created_at),
    granted_at = CASE WHEN enabled = 1 THEN COALESCE(granted_at, created_at) ELSE granted_at END
WHERE status = 'inactive';

CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations(status);
