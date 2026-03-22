ALTER TABLE pieces ADD COLUMN legacy_mainnet INTEGER DEFAULT 0;
ALTER TABLE pieces ADD COLUMN legacy_reason TEXT;
ALTER TABLE pieces ADD COLUMN proposal_tx TEXT;
ALTER TABLE pieces ADD COLUMN proposed_at TEXT;

UPDATE pieces
SET legacy_mainnet = 1,
    legacy_reason = COALESCE(
      legacy_reason,
      'Legacy piece created before Base mainnet proposal bridge'
    )
WHERE chain_piece_id IS NULL
  AND COALESCE(legacy_mainnet, 0) = 0;

CREATE INDEX IF NOT EXISTS idx_pieces_legacy_mainnet ON pieces(legacy_mainnet);
CREATE INDEX IF NOT EXISTS idx_pieces_chain_piece_id ON pieces(chain_piece_id);
