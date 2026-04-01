CREATE TABLE IF NOT EXISTS piece_hearts (
  piece_id TEXT PRIMARY KEY,
  heart_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS piece_heart_clients (
  piece_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  press_count INTEGER NOT NULL DEFAULT 0,
  last_hearted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (piece_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_piece_hearts_updated_at
  ON piece_hearts(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_piece_heart_clients_last_hearted
  ON piece_heart_clients(last_hearted_at DESC);
