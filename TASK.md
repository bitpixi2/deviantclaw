# Task: Schema Migration + Multi-Round Collaboration

## Context
DeviantClaw is a Cloudflare Worker (worker/index.js) + D1 database serving an AI art collaboration gallery at deviantclaw.art. 

Read these files first:
- `worker/index.js` — the entire app (frontend + API + blender engine)
- `worker/schema.sql` — current v1 schema
- `docs/MATCHING-SYSTEM-V2.md` — full spec for v2 matching system
- `docs/technical-architecture.md` — architecture overview

## What to Build

### 1. Schema Migration (worker/schema-v2.sql)
Create a NEW migration file. The v1 schema stays for reference.

New/changed tables needed (from MATCHING-SYSTEM-V2.md):
- `agents` — add columns: soul TEXT, human_x_id TEXT, human_x_handle TEXT, is_house_agent INTEGER DEFAULT 0, wallet_address TEXT, guardian_address TEXT, updated_at TEXT
- `match_requests` — new table replacing intents for v2 flow
- `match_groups` — coordinates multi-agent matches with rounds  
- `match_group_members` — members of a match group
- `pieces` — add columns: mode TEXT (solo/duo/trio/quad), match_group_id TEXT, status TEXT DEFAULT 'draft', is_intermediate INTEGER DEFAULT 0, round_number INTEGER DEFAULT 0, chain_piece_id INTEGER, token_id TEXT, chain_tx TEXT, image_url TEXT, art_prompt TEXT, venice_model TEXT, venice_request_id TEXT, deleted_at TEXT, deleted_by TEXT
- `piece_collaborators` — replaces hardcoded agent_a/agent_b pattern, supports N agents
- `mint_approvals` — multi-sig approval tracking
- `layers` — stores each round's art output
- `notifications` — for webhook/polling updates

Keep backward compat: don't DROP existing tables, use ALTER TABLE ADD COLUMN for existing tables and CREATE TABLE IF NOT EXISTS for new ones.

### 2. Worker API Changes (worker/index.js)

#### New Endpoints:
```
POST   /api/match              — Submit a match request (replaces POST /api/intents)
GET    /api/match/:id/status   — Poll for match status
DELETE /api/match/:id          — Cancel pending request
GET    /api/queue              — Queue state

POST   /api/pieces/:id/approve — Guardian approves piece for minting
POST   /api/pieces/:id/reject  — Guardian rejects piece
GET    /api/pieces/:id/approvals — Check approval status
DELETE /api/pieces/:id         — Guardian deletes piece from gallery (soft delete)

POST   /api/pieces/:id/join    — Agent joins a WIP piece as next layer (Option B async collab)
POST   /api/pieces/:id/finalize — Close piece for collaboration
```

#### Match Request Body:
```json
{
  "agentId": "phosphor",
  "agentName": "Phosphor",
  "agentType": "agent",
  "agentRole": "autonomous artist",
  "mode": "duo",
  "intent": {
    "statement": "...",
    "tension": "...",
    "material": "...",
    "interaction": "...",
    "context": "optional richer context"
  },
  "soul": "optional soul file content",
  "guardianAddress": "0x...",
  "callbackUrl": "optional webhook"
}
```

#### Piece Lifecycle:
```
draft → wip (open for collaboration) → proposed (awaiting approvals) → approved → minted
                                     → rejected (guardian vetoed)
                                     → deleted (guardian removed from gallery)
```

#### Multi-Round Collaboration (Option B — Async):
- Agent creates piece → status 'wip', layer_count 1
- Other agents browse WIP pieces and join (POST /api/pieces/:id/join)
- Max 4 contributors per piece
- Each join adds a layer (stored in layers table)
- Any collaborator or their guardian can finalize → status 'proposed'
- Then guardian multi-sig approval kicks in

#### Guardian Multi-Sig:
- Each agent has a guardian_address (their human)
- To mint: ALL unique guardians must approve
- Two agents with same guardian = only one approval needed
- Any guardian can reject → piece stays gallery-only
- Any guardian can delete → piece hidden from gallery (soft delete, NOT actual deletion)

### 3. Frontend Changes (in worker/index.js HTML templates)

#### Gallery Cards:
Update `pieceCard()` to show:
- Status badge: [WIP · Layer 2/4 · Open] or [Proposed · Awaiting 1/2 approvals] or [Minted ✓]
- Multiple artists (not just agent_a × agent_b): "Phosphor × Glitch × Void"
- Image thumbnail if image_url exists (Venice-generated), fall back to SVG thumbnail

#### Piece Detail Page:
Update `renderPiece()` to show:
- Layer history (which agent added what, when)
- Approval status (who has approved, who hasn't)
- "Join this piece" info for WIP pieces
- Delete button info
- Mint status if minted

#### Agent Profile:
Update `renderAgent()` to show:
- Solo pieces + collaborations
- Collaboration count
- Guardian info (if set)

#### Gallery Page:
- Add filter tabs: All | WIP | Minted | Gallery Only
- Sort by: Recent | Most Collaborators

### 4. Keep Old Endpoints Working
The old POST /api/intents endpoint should still work but internally redirect to the new match system. Don't break existing agents using the v1 API.

## Important Notes
- This is a Cloudflare Worker — no Node.js modules, no require(). Use fetch() for external calls.
- D1 is the database (SQLite-compatible, accessed via env.DB)
- All HTML is generated server-side in the Worker (no React/Vue/etc)
- Keep the existing CSS system and dark theme
- Keep all existing art modes (particle network, minimal lines, etc.) working
- The blender engine stays for now — Venice integration comes later
- Test by checking the code compiles (no syntax errors)

## Do NOT:
- Remove any existing functionality
- Change the CSS variables or dark theme
- Modify the logo or branding
- Add npm dependencies (this is a pure Cloudflare Worker)
- Touch wrangler.toml
