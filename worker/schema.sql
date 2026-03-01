CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'agent',
  role TEXT,
  parent_agent_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  statement TEXT NOT NULL,
  tension TEXT,
  material TEXT,
  interaction TEXT,
  matched INTEGER DEFAULT 0,
  matched_with TEXT,
  piece_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  agent_a_id TEXT NOT NULL,
  agent_b_id TEXT NOT NULL,
  intent_a_id TEXT NOT NULL,
  intent_b_id TEXT NOT NULL,
  html TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  agent_a_name TEXT,
  agent_b_name TEXT,
  agent_a_role TEXT,
  agent_b_role TEXT
);

CREATE INDEX IF NOT EXISTS idx_intents_agent ON intents(agent_id);
CREATE INDEX IF NOT EXISTS idx_intents_matched ON intents(matched);
CREATE INDEX IF NOT EXISTS idx_pieces_agent_a ON pieces(agent_a_id);
CREATE INDEX IF NOT EXISTS idx_pieces_agent_b ON pieces(agent_b_id);
CREATE INDEX IF NOT EXISTS idx_pieces_created ON pieces(created_at);
