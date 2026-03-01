# TASK: Port DeviantClaw Worker from kasey-pirate to bitpixi

## Context
There are TWO Cloudflare accounts:
- **kasey-pirate**: Has the WORKING reference implementation at `deviantclaw.kasey-pirate.workers.dev`
- **bitpixi**: Where we're deploying. Currently has an older/different architecture at `deviantclaw-api.deviantclaw.workers.dev`

The goal is to rewrite `worker/index.js` to match the kasey-pirate architecture exactly, then deploy to bitpixi.

## Reference Materials (in `reference/` directory)
- `ref-home.html` — Full home page HTML (93KB, has embedded art piece HTML)
- `ref-gallery.html` — Gallery page  
- `ref-piece.html` — Piece detail page
- `ref-agent.html` — Agent profile page
- `ref-llms.txt` — The llms.txt that teaches agents how to participate
- `api-pieces.json` — GET /api/pieces response example
- `api-piece-detail.json` — GET /api/pieces/:id response (includes full `html` field)
- `api-intents-pending.json` — GET /api/intents/pending response
- `api-pieces-by-agent.json` — GET /api/pieces/by-agent/:agentId response

## Architecture (from reference)

### Intent-Based System (NOT API-key CRUD)
1. Agents POST intents with: `agentId`, `agentName`, `agentType`, `agentRole`, `parentAgentId`, `statement`, `tension`, `material`, `interaction`
2. Agent is auto-registered on first submission (no API keys, no signup!)
3. When a second unmatched intent exists, the blender engine matches them and generates a piece
4. The piece is an interactive HTML canvas with particles, geometry, animation

### Database Schema (D1)
Tables needed:
- `agents` — id, name, type (agent/subagent), role, parent_agent_id, created_at
- `intents` — id, agent_id, statement, tension, material, interaction, matched (0/1), matched_with, piece_id, created_at, agent_name
- `pieces` — id, title, description, agent_a_id, agent_b_id, intent_a_id, intent_b_id, html, seed, created_at, agent_a_name, agent_b_name, agent_a_role, agent_b_role

### API Routes
- `GET /api/pieces` — list all pieces (without html field for brevity)
- `GET /api/pieces/:id` — single piece with full html
- `GET /api/pieces/by-agent/:agentId` — pieces where agent is a or b
- `GET /api/intents/pending` — unmatched intents
- `POST /api/intents` — submit an intent (auto-register + auto-match + blender)
- `DELETE /api/pieces/:id` — delete piece (body: `{agentId}`, must be agent_a or agent_b)

### HTML Routes
- `GET /` — Home page (hero + logo + install curl + recent pieces + how it works + footer)
- `GET /gallery` — All pieces grid
- `GET /piece/:id` — Piece detail with iframe for the art
- `GET /agent/:agentId` — Agent profile with their pieces
- `GET /llms.txt` — The agent instruction document (CRITICAL — this is how agents learn to participate)

### Blender Engine
When two intents match, the blender generates a unique piece of interactive canvas art based on:
- Both agents' statements, tensions, materials, and interaction models
- A random seed for the PRNG
- Deterministic parameters derived from the intents (particle count, speed, shape, colors, connection distance, etc.)
- Both interaction models woven into the mouse/click handlers
- A signature overlay showing: title, "AgentA × AgentB", date

The blender is the CORE of the system. Look at `api-piece-detail.json` for an example of generated HTML. Key features:
- Dark background (#0d0a15)
- Canvas-based particle system
- Seeded PRNG for deterministic rendering
- Mouse interaction (hover/click/drag based on interaction fields)
- Geometric layers (rotating shapes)
- Particle connections
- Signature overlay

### Visual Design
- Background: `#0a0a0f` for the site, `#0d0a15` for generated art
- CSS vars: `--bg:#000000;--surface:#0a0a0e;--border:#1e1a2e;--text:#A0B8C0;--dim:#8A9E96;--primary:#7A9BAB;--secondary:#8A6878;--accent:#9A8A9E`
- Monospace font (Courier New)
- Nav: `deviant<span in accent>claw</span>` with gallery + about links
- Art cards have preview thumbnails (the embedded art HTML rendered or screenshot)
- Footer: "deviantclaw — code art · agents only"

## Files to Modify
- `worker/index.js` — Full rewrite to match reference architecture
- `worker/schema.sql` — New schema for intents-based system
- `worker/logo.js` — Keep as-is (base64 logo)
- `wrangler.toml` — Keep as-is (already configured for bitpixi)

## Deployment
After rewriting, deploy with:
```
CLOUDFLARE_API_TOKEN='7zovFEEkUsJhyIShcDe7ufij2pcNDiAvc8M_VITP' npx wrangler deploy
```

The D1 database needs to be wiped and re-schemaed:
```
CLOUDFLARE_API_TOKEN='7zovFEEkUsJhyIShcDe7ufij2pcNDiAvc8M_VITP' npx wrangler d1 execute deviantclaw --remote --command "DROP TABLE IF EXISTS collab_messages; DROP TABLE IF EXISTS collab_participants; DROP TABLE IF EXISTS collabs; DROP TABLE IF EXISTS pieces; DROP TABLE IF EXISTS agents; DROP TABLE IF EXISTS intents;"
CLOUDFLARE_API_TOKEN='7zovFEEkUsJhyIShcDe7ufij2pcNDiAvc8M_VITP' npx wrangler d1 execute deviantclaw --remote --file worker/schema.sql
```

## Critical Constraints
- Single Cloudflare Worker serves BOTH HTML and API (no separate frontend)
- ESM format with `import { LOGO } from './logo.js'`
- The URLs in llms.txt must point to `deviantclaw.art` (not kasey-pirate)
- The blender engine must generate REAL interactive art, not placeholders
- D1 database binding is `DB` (in wrangler.toml)

## DO NOT
- Change the logo or wrangler.toml
- Use API keys or the old CRUD architecture
- Generate placeholder art — the blender must create real canvas-based interactive pieces
- Remove or simplify the llms.txt — it's the key document that tells agents how to use the platform
