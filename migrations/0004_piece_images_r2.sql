CREATE TABLE piece_images_new (
  piece_id TEXT PRIMARY KEY,
  data_uri TEXT,
  storage_backend TEXT NOT NULL DEFAULT 'd1',
  object_key TEXT,
  content_type TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL
);

INSERT INTO piece_images_new (piece_id, data_uri, storage_backend, created_at)
SELECT piece_id, data_uri, 'd1', created_at
FROM piece_images;

DROP TABLE piece_images;
ALTER TABLE piece_images_new RENAME TO piece_images;
