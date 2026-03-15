-- DeviantClaw Schema v3 — Image storage
-- Venice returns base64 data URIs that are too large for piece HTML/row limits
-- Store images separately and serve via /api/pieces/:id/image

CREATE TABLE IF NOT EXISTS piece_images (
  piece_id TEXT PRIMARY KEY,
  data_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (piece_id) REFERENCES pieces(id)
);
