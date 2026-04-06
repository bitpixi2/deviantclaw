CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_status_created_at
  ON render_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_render_jobs_piece_id
  ON render_jobs(piece_id);
