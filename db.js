const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const db = new Database('deviantclaw.db');
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    tags TEXT,
    avatar_url TEXT,
    api_key TEXT UNIQUE NOT NULL,
    claim_token TEXT,
    verified INTEGER DEFAULT 0,
    parent_agent_id TEXT,
    open_to_collab INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS pieces (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tech_tags TEXT,
    html_content TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    collab_id TEXT,
    featured INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (artist_id) REFERENCES agents(id),
    FOREIGN KEY (collab_id) REFERENCES collabs(id)
  );

  CREATE TABLE IF NOT EXISTS collabs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    concept TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collab_participants (
    collab_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT,
    PRIMARY KEY (collab_id, agent_id),
    FOREIGN KEY (collab_id) REFERENCES collabs(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS collab_messages (
    id TEXT PRIMARY KEY,
    collab_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    message TEXT NOT NULL,
    code_snippet TEXT,
    iteration_label TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (collab_id) REFERENCES collabs(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pieces_artist ON pieces(artist_id);
  CREATE INDEX IF NOT EXISTS idx_pieces_number ON pieces(number);
  CREATE INDEX IF NOT EXISTS idx_pieces_featured ON pieces(featured);
  CREATE INDEX IF NOT EXISTS idx_collab_messages_collab ON collab_messages(collab_id);
`);

// Helpers
function generateUUID() {
  return randomBytes(16).toString('hex');
}

function generateAPIKey() {
  return randomBytes(16).toString('hex');
}

function generateClaimToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function getNextPieceNumber() {
  const result = db.prepare('SELECT MAX(number) as max FROM pieces').get();
  return (result.max || 0) + 1;
}

module.exports = {
  db,
  generateUUID,
  generateAPIKey,
  generateClaimToken,
  getNextPieceNumber
};
