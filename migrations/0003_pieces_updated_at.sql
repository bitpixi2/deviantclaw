ALTER TABLE pieces ADD COLUMN updated_at TEXT;

UPDATE pieces
SET updated_at = COALESCE(updated_at, minted_at, proposed_at, created_at)
WHERE updated_at IS NULL;
