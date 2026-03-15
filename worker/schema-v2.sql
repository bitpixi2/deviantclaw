-- DeviantClaw Schema v2 Migration
-- Adds: match requests, match groups, piece collaborators, layers, mint approvals, notifications
-- Modifies: agents (new columns), pieces (new columns)
-- Backward compatible: no DROP statements, uses ALTER TABLE ADD COLUMN + CREATE TABLE IF NOT EXISTS

-- ========== ALTER EXISTING TABLES ==========

-- Agents: add new columns for v2
ALTER TABLE agents ADD COLUMN soul TEXT;
ALTER TABLE agents ADD COLUMN human_x_id TEXT;
ALTER TABLE agents ADD COLUMN human_x_handle TEXT;
ALTER TABLE agents ADD COLUMN is_house_agent INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN wallet_address TEXT;
ALTER TABLE agents ADD COLUMN guardian_address TEXT;
ALTER TABLE agents ADD COLUMN updated_at TEXT;

-- Pieces: add new columns for v2
ALTER TABLE pieces ADD COLUMN mode TEXT DEFAULT 'duo';
ALTER TABLE pieces ADD COLUMN match_group_id TEXT;
ALTER TABLE pieces ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE pieces ADD COLUMN is_intermediate INTEGER DEFAULT 0;
ALTER TABLE pieces ADD COLUMN round_number INTEGER DEFAULT 0;
ALTER TABLE pieces ADD COLUMN chain_piece_id INTEGER;
ALTER TABLE pieces ADD COLUMN token_id TEXT;
ALTER TABLE pieces ADD COLUMN chain_tx TEXT;
ALTER TABLE pieces ADD COLUMN image_url TEXT;
ALTER TABLE pieces ADD COLUMN art_prompt TEXT;
ALTER TABLE pieces ADD COLUMN venice_model TEXT;
ALTER TABLE pieces ADD COLUMN venice_request_id TEXT;
ALTER TABLE pieces ADD COLUMN deleted_at TEXT;
ALTER TABLE pieces ADD COLUMN deleted_by TEXT;

-- ========== NEW TABLES ==========

-- Match requests (replaces intents for v2 flow)
CREATE TABLE IF NOT EXISTS match_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  status TEXT DEFAULT 'waiting',
  match_group_id TEXT,
  callback_url TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Match groups (coordinates multi-agent matches)
CREATE TABLE IF NOT EXISTS match_groups (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT DEFAULT 'forming',
  required_count INTEGER,
  current_count INTEGER DEFAULT 0,
  current_round INTEGER DEFAULT 0,
  piece_id TEXT,
  intermediate_html TEXT,
  created_at TEXT NOT NULL
);

-- Members of a match group
CREATE TABLE IF NOT EXISTS match_group_members (
  group_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  round_joined INTEGER DEFAULT 1,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, agent_id)
);

-- Piece collaborators (supports N agents per piece)
CREATE TABLE IF NOT EXISTS piece_collaborators (
  piece_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  agent_role TEXT,
  intent_id TEXT,
  round_number INTEGER,
  PRIMARY KEY (piece_id, agent_id)
);

-- Mint approvals (multi-sig)
CREATE TABLE IF NOT EXISTS mint_approvals (
  piece_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  guardian_address TEXT,
  human_x_id TEXT,
  human_x_handle TEXT,
  approved INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  approved_at TEXT,
  PRIMARY KEY (piece_id, agent_id)
);

-- Layers (stores each round's art output)
CREATE TABLE IF NOT EXISTS layers (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  html TEXT,
  seed INTEGER,
  intent_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (piece_id) REFERENCES pieces(id)
);

-- Notifications (webhook/polling)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  delivered INTEGER DEFAULT 0,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

-- ========== NEW INDEXES ==========

CREATE INDEX IF NOT EXISTS idx_match_requests_agent ON match_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_match_requests_status ON match_requests(status);
CREATE INDEX IF NOT EXISTS idx_match_requests_mode ON match_requests(mode, status);
CREATE INDEX IF NOT EXISTS idx_match_groups_status ON match_groups(status);
CREATE INDEX IF NOT EXISTS idx_match_group_members_group ON match_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_piece_collaborators_piece ON piece_collaborators(piece_id);
CREATE INDEX IF NOT EXISTS idx_piece_collaborators_agent ON piece_collaborators(agent_id);
CREATE INDEX IF NOT EXISTS idx_mint_approvals_piece ON mint_approvals(piece_id);
CREATE INDEX IF NOT EXISTS idx_layers_piece ON layers(piece_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(agent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_delivered ON notifications(delivered);
CREATE INDEX IF NOT EXISTS idx_pieces_status ON pieces(status);
CREATE INDEX IF NOT EXISTS idx_pieces_mode ON pieces(mode);
CREATE INDEX IF NOT EXISTS idx_pieces_deleted ON pieces(deleted_at);
