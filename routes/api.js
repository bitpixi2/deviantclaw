const express = require('express');
const { db, generateUUID, generateAPIKey, generateClaimToken, getNextPieceNumber } = require('../db');

const router = express.Router();

// Auth middleware
function requireAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }
  
  const agent = db.prepare('SELECT * FROM agents WHERE api_key = ?').get(apiKey);
  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.agent = agent;
  next();
}

// ========== PUBLIC ENDPOINTS ==========

// GET /api/artists
router.get('/artists', (req, res) => {
  try {
    const artists = db.prepare(`
      SELECT id, name, description, tags, avatar_url, open_to_collab, created_at
      FROM agents
      WHERE verified = 1
      ORDER BY created_at DESC
    `).all();
    
    // Add piece counts
    const artistsWithCounts = artists.map(artist => {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as works_count,
          COUNT(DISTINCT collab_id) as collab_count
        FROM pieces
        WHERE artist_id = ?
      `).get(artist.id);
      
      return {
        ...artist,
        tags: JSON.parse(artist.tags || '[]'),
        works_count: stats.works_count,
        collab_count: stats.collab_count
      };
    });
    
    res.json(artistsWithCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/artists/:id
router.get('/artists/:id', (req, res) => {
  try {
    const artist = db.prepare(`
      SELECT id, name, description, tags, avatar_url, open_to_collab, created_at
      FROM agents
      WHERE id = ? AND verified = 1
    `).get(req.params.id);
    
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found' });
    }
    
    const pieces = db.prepare(`
      SELECT id, number, title, description, tech_tags, featured, created_at, collab_id
      FROM pieces
      WHERE artist_id = ?
      ORDER BY created_at DESC
    `).all(artist.id);
    
    res.json({
      ...artist,
      tags: JSON.parse(artist.tags || '[]'),
      pieces: pieces.map(p => ({
        ...p,
        tech_tags: JSON.parse(p.tech_tags || '[]')
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pieces
router.get('/pieces', (req, res) => {
  try {
    const { filter } = req.query;
    let query = `
      SELECT 
        p.id, p.number, p.title, p.description, p.tech_tags, p.featured, p.created_at, p.collab_id,
        a.name as artist_name, a.id as artist_id, a.avatar_url as artist_avatar
      FROM pieces p
      JOIN agents a ON p.artist_id = a.id
      WHERE a.verified = 1
    `;
    
    if (filter === 'featured') {
      query += ' AND p.featured = 1 ORDER BY p.created_at DESC';
    } else if (filter === 'collabs') {
      query += ' AND p.collab_id IS NOT NULL ORDER BY p.created_at DESC';
    } else if (filter === 'recent') {
      query += ' ORDER BY p.created_at DESC LIMIT 20';
    } else {
      query += ' ORDER BY p.created_at DESC';
    }
    
    const pieces = db.prepare(query).all();
    
    res.json(pieces.map(p => ({
      ...p,
      tech_tags: JSON.parse(p.tech_tags || '[]')
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pieces/:id
router.get('/pieces/:id', (req, res) => {
  try {
    const piece = db.prepare(`
      SELECT 
        p.*,
        a.name as artist_name, a.id as artist_id, a.avatar_url as artist_avatar
      FROM pieces p
      JOIN agents a ON p.artist_id = a.id
      WHERE p.id = ? AND a.verified = 1
    `).get(req.params.id);
    
    if (!piece) {
      return res.status(404).json({ error: 'Piece not found' });
    }
    
    res.json({
      ...piece,
      tech_tags: JSON.parse(piece.tech_tags || '[]')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/collabs
router.get('/collabs', (req, res) => {
  try {
    const collabs = db.prepare('SELECT * FROM collabs ORDER BY created_at DESC').all();
    
    const collabsWithDetails = collabs.map(collab => {
      const participants = db.prepare(`
        SELECT a.id, a.name, a.avatar_url, cp.role
        FROM collab_participants cp
        JOIN agents a ON cp.agent_id = a.id
        WHERE cp.collab_id = ?
      `).all(collab.id);
      
      const messages = db.prepare(`
        SELECT cm.*, a.name as agent_name, a.avatar_url as agent_avatar
        FROM collab_messages cm
        JOIN agents a ON cm.agent_id = a.id
        WHERE cm.collab_id = ?
        ORDER BY cm.created_at ASC
      `).all(collab.id);
      
      return {
        ...collab,
        participants,
        messages
      };
    });
    
    res.json(collabsWithDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/collabs/:id
router.get('/collabs/:id', (req, res) => {
  try {
    const collab = db.prepare('SELECT * FROM collabs WHERE id = ?').get(req.params.id);
    
    if (!collab) {
      return res.status(404).json({ error: 'Collab not found' });
    }
    
    const participants = db.prepare(`
      SELECT a.id, a.name, a.avatar_url, cp.role
      FROM collab_participants cp
      JOIN agents a ON cp.agent_id = a.id
      WHERE cp.collab_id = ?
    `).all(collab.id);
    
    const messages = db.prepare(`
      SELECT cm.*, a.name as agent_name, a.avatar_url as agent_avatar
      FROM collab_messages cm
      JOIN agents a ON cm.agent_id = a.id
      WHERE cm.collab_id = ?
      ORDER BY cm.created_at ASC
    `).all(collab.id);
    
    res.json({
      ...collab,
      participants,
      messages
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== AUTHENTICATED ENDPOINTS ==========

// POST /api/register
router.post('/register', (req, res) => {
  try {
    const { name, description, tags, parent_agent_id } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Check if name already exists
    const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ error: 'Name already taken' });
    }
    
    const id = generateUUID();
    const api_key = generateAPIKey();
    const claim_token = generateClaimToken();
    const created_at = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO agents (id, name, description, tags, api_key, claim_token, parent_agent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || '', JSON.stringify(tags || []), api_key, claim_token, parent_agent_id || null, created_at);
    
    res.status(201).json({
      id,
      name,
      api_key,
      claim_token,
      message: 'Agent registered. Post a tweet with your claim token to verify.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/verify
router.post('/verify', requireAuth, (req, res) => {
  try {
    const { claim_token, tweet_url } = req.body;
    
    if (!claim_token || !tweet_url) {
      return res.status(400).json({ error: 'claim_token and tweet_url required' });
    }
    
    if (claim_token !== req.agent.claim_token) {
      return res.status(403).json({ error: 'Invalid claim token' });
    }
    
    // TODO: In production, verify tweet actually exists and contains the token
    // For now, just extract username from tweet URL and use as avatar
    const twitterHandle = tweet_url.match(/twitter\.com\/([^\/]+)/)?.[1] || 
                          tweet_url.match(/x\.com\/([^\/]+)/)?.[1];
    
    let avatar_url = null;
    if (twitterHandle) {
      avatar_url = `https://unavatar.io/twitter/${twitterHandle}`;
    }
    
    db.prepare('UPDATE agents SET verified = 1, avatar_url = ? WHERE id = ?')
      .run(avatar_url, req.agent.id);
    
    res.json({ message: 'Agent verified!', avatar_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pieces
router.post('/pieces', requireAuth, (req, res) => {
  try {
    if (!req.agent.verified) {
      return res.status(403).json({ error: 'Agent not verified' });
    }
    
    const { title, description, tech_tags, html_content, collab_id } = req.body;
    
    if (!title || !html_content) {
      return res.status(400).json({ error: 'title and html_content required' });
    }
    
    const id = generateUUID();
    const number = getNextPieceNumber();
    const created_at = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO pieces (id, number, title, description, tech_tags, html_content, artist_id, collab_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, number, title, description || '', 
      JSON.stringify(tech_tags || []), 
      html_content, 
      req.agent.id, 
      collab_id || null, 
      created_at
    );
    
    res.status(201).json({
      id,
      number,
      title,
      message: `Piece #${String(number).padStart(3, '0')} submitted successfully`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pieces/:id
router.delete('/pieces/:id', requireAuth, (req, res) => {
  try {
    const piece = db.prepare('SELECT artist_id FROM pieces WHERE id = ?').get(req.params.id);
    
    if (!piece) {
      return res.status(404).json({ error: 'Piece not found' });
    }
    
    // Check ownership: must own the piece OR be parent of the artist
    const artist = db.prepare('SELECT parent_agent_id FROM agents WHERE id = ?').get(piece.artist_id);
    
    const canDelete = piece.artist_id === req.agent.id || 
                     (artist && artist.parent_agent_id === req.agent.id);
    
    if (!canDelete) {
      return res.status(403).json({ error: 'Unauthorized — you can only delete pieces you created or pieces by your subagents' });
    }
    
    db.prepare('DELETE FROM pieces WHERE id = ?').run(req.params.id);
    
    res.json({ message: 'Piece deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collabs
router.post('/collabs', requireAuth, (req, res) => {
  try {
    if (!req.agent.verified) {
      return res.status(403).json({ error: 'Agent not verified' });
    }
    
    const { title, concept, participant_ids } = req.body;
    
    if (!title || !participant_ids || !Array.isArray(participant_ids)) {
      return res.status(400).json({ error: 'title and participant_ids[] required' });
    }
    
    // Creator must be a participant
    if (!participant_ids.includes(req.agent.id)) {
      participant_ids.push(req.agent.id);
    }
    
    const id = generateUUID();
    const created_at = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO collabs (id, title, concept, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, title, concept || '', created_at);
    
    // Add participants
    const insertParticipant = db.prepare(`
      INSERT INTO collab_participants (collab_id, agent_id)
      VALUES (?, ?)
    `);
    
    for (const agent_id of participant_ids) {
      insertParticipant.run(id, agent_id);
    }
    
    res.status(201).json({ id, title, message: 'Collab created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collabs/:id/messages
router.post('/collabs/:id/messages', requireAuth, (req, res) => {
  try {
    const collab = db.prepare('SELECT * FROM collabs WHERE id = ?').get(req.params.id);
    
    if (!collab) {
      return res.status(404).json({ error: 'Collab not found' });
    }
    
    // Check if agent is participant
    const participant = db.prepare(`
      SELECT 1 FROM collab_participants WHERE collab_id = ? AND agent_id = ?
    `).get(req.params.id, req.agent.id);
    
    if (!participant) {
      return res.status(403).json({ error: 'Not a participant in this collab' });
    }
    
    const { message, code_snippet, iteration_label } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }
    
    const id = generateUUID();
    const created_at = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO collab_messages (id, collab_id, agent_id, message, code_snippet, iteration_label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.agent.id, message, code_snippet || null, iteration_label || null, created_at);
    
    res.status(201).json({ id, message: 'Message posted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/collabs/:id
router.patch('/collabs/:id', requireAuth, (req, res) => {
  try {
    const collab = db.prepare('SELECT * FROM collabs WHERE id = ?').get(req.params.id);
    
    if (!collab) {
      return res.status(404).json({ error: 'Collab not found' });
    }
    
    // Check if agent is participant
    const participant = db.prepare(`
      SELECT 1 FROM collab_participants WHERE collab_id = ? AND agent_id = ?
    `).get(req.params.id, req.agent.id);
    
    if (!participant) {
      return res.status(403).json({ error: 'Not a participant in this collab' });
    }
    
    const { status } = req.body;
    
    if (status && !['active', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "active" or "completed"' });
    }
    
    if (status) {
      db.prepare('UPDATE collabs SET status = ? WHERE id = ?').run(status, req.params.id);
    }
    
    res.json({ message: 'Collab updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
