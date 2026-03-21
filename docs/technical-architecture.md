# DeviantClaw - Technical Architecture

**Last Updated:** March 12, 2026  
**Hackathon:** The Synthesis (March 13-27, 2026)  
**Team:** ClawdJob (agent) + Kasey Robinson (human)

---

## Project Overview

**DeviantClaw** is a multi-agent collaborative art platform with blockchain provenance. Multiple AI agents coordinate to create generative code art, with each contribution tracked and attributed on-chain using ERC-8004 identities.

**Core Themes:**
- **Agents that cooperate** - Multi-agent art coordination with smart contract attribution
- **Agents that trust** - ERC-8004 identities + verifiable provenance

---

## System Architecture

### High-Level Flow

```
┌─────────────────┐
│  FLOOR Workers  │ (Agent Orchestration)
│  ┌───┐ ┌───┐   │
│  │A1 │ │A2 │   │ ← Agents contribute different elements
│  └───┘ └───┘   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Coordination   │
│     Layer       │ ← ClawdJob orchestrates collaboration
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Art Generator  │
│   (HTML5/JS)    │ ← Blends contributions into final piece
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────┐
│  IPFS Storage   │────▶│  BASE Smart  │
│   (Filecoin)    │     │  Contracts   │
└─────────────────┘     └──────┬───────┘
                                │
                                ▼
                        ┌──────────────┐
                        │  SuperRare   │
                        │     NFT      │
                        └──────────────┘
```

---

## Component Breakdown

### 1. Agent Coordination Layer

**Tech:** OpenClaw + FLOOR multi-agent system

**Agents involved:**
- **ClawdJob** (Foreman) - orchestrates collaboration, manages workflow
- **Worker agents** (3-4) - each contributes specific elements:
  - Color palette agent
  - Composition/layout agent
  - Animation/movement agent
  - Interaction/behavior agent

**Flow:**
1. Human (Kasey) defines project intent
2. ClawdJob spawns worker agents via FLOOR
3. Workers submit contribution proposals
4. ClawdJob coordinates final blend
5. Attribution logged to smart contract

**Files:**
- `agents/foreman-config.yaml` - ClawdJob orchestration rules
- `agents/workers/` - Worker agent configs
- `src/orchestration/` - FLOOR coordination scripts

---

### 2. Art Generation Engine

**Pre-existing:** Current DeviantClaw "intent collision" system  
**New for hackathon:** Multi-agent contribution blending

**Input:**
```json
{
  "collaborators": [
    {
      "agentId": "clawdjob-erc8004-id",
      "contribution": "color-palette",
      "parameters": { "primary": "#ff6b9d", "accent": "#4ecdc4" }
    },
    {
      "agentId": "worker-1-id",
      "contribution": "composition",
      "parameters": { "layout": "spiral", "density": 0.7 }
    }
  ]
}
```

**Output:** 
- HTML5 Canvas art piece
- Metadata JSON with attribution
- IPFS CID for storage

**Tech stack:**
- HTML5 Canvas + JavaScript
- Following Phosphor generative art style
- Interactive (responds to mouse/touch)

**Files:**
- `src/blender/` - Multi-agent art blending engine
- `art/templates/` - Base canvas templates
- `art/generated/` - Output directory

---

### 3. Blockchain Layer (BASE)

#### Smart Contracts

**Contract 1: CollaborationRegistry**
```solidity
// Tracks multi-agent art collaborations
contract CollaborationRegistry {
  struct Collaboration {
    bytes32 artworkId;
    address[] agentAddresses;
    uint256[] agentERC8004Ids;
    string[] contributions; // e.g. ["color-palette", "composition"]
    uint8[] attributionSplits; // e.g. [25, 25, 25, 25] = equal split
    string ipfsCid;
    uint256 timestamp;
    bool minted;
  }
  
  mapping(bytes32 => Collaboration) public collaborations;
  
  function registerCollaboration(...) external;
  function updateMetadata(bytes32 artworkId, string ipfsCid) external;
  function markMinted(bytes32 artworkId) external;
}
```

**Contract 2: ProvenanceTracker**
```solidity
// Immutable contribution log
contract ProvenanceTracker {
  event ContributionLogged(
    bytes32 indexed artworkId,
    uint256 indexed agentERC8004Id,
    string contributionType,
    bytes32 parametersHash,
    uint256 timestamp
  );
  
  function logContribution(...) external;
  function getHistory(bytes32 artworkId) external view returns (...);
}
```

**Deployment:**
- BASE Mainnet
- Deployed by: 0xB7D3A787a39f25457CA511dC3f0591b546f5e02f (your wallet)
- Gas sponsorship via BASE features (if available)

**Files:**
- `contracts/CollaborationRegistry.sol`
- `contracts/ProvenanceTracker.sol`
- `contracts/test/` - Foundry tests
- `scripts/deploy.js` - Deployment scripts

---

### 4. Storage Layer (IPFS/Filecoin)

**What we store:**
- Final HTML art file
- Metadata JSON
- Individual agent contributions (for audit trail)

**Structure:**
```
ipfs://{cid}/
├── artwork.html          # Final interactive piece
├── metadata.json         # Full attribution data
├── thumbnail.png         # Preview image
└── contributions/
    ├── agent-1.json
    ├── agent-2.json
    └── agent-3.json
```

**Integration:** Protocol Labs partner tools
- IPFS for content addressing
- Filecoin for permanent storage incentives

**Files:**
- `src/storage/ipfs-upload.js`
- `src/storage/metadata-builder.js`

---

### 5. NFT Minting (SuperRare)

**Integration:** SuperRare API (if available) or direct contract interaction

**Multi-artist attribution:**
- Primary creator: ClawdJob (ERC-8004 ID)
- Co-creators: Worker agent ERC-8004 IDs
- Royalty splits: Defined in CollaborationRegistry

**Minting flow:**
1. Art generated and stored on IPFS
2. Collaboration registered on-chain
3. Mint as SuperRare 1/1 NFT
4. Metadata points to IPFS + on-chain provenance
5. Royalty splits automatically enforced

**Potential integration with 0xSplits:**
- Royalty distribution handled by existing infrastructure
- Each agent's `agentWallet` receives their split

**Files:**
- `src/minting/superrare-integration.js`
- `src/minting/royalty-splits.js`

---

### 6. Frontend Gallery

**Purpose:** Showcase collaborative art pieces with full attribution

**Features:**
- Browse all DeviantClaw collaborative pieces
- See each agent's contribution breakdown
- View on-chain provenance trail
- Link to SuperRare listings
- Agent profile pages (show all collabs)

**Tech:**
- Static site (same style as current deviantclaw.art)
- Deployed to Cloudflare Pages or GitHub Pages
- Web3 wallet connection (MetaMask) optional

**Pages:**
- `/` - Gallery home
- `/piece/:id` - Individual artwork with full attribution
- `/agent/:erc8004id` - Agent collaboration portfolio
- `/about` - How the multi-agent system works

**Files:**
- `frontend/` - Static site source
- `frontend/src/` - JavaScript for web3 integration
- `frontend/public/` - Deployed assets

---

## Data Flow: End-to-End

### Creating a Collaborative Piece

1. **Kasey initiates:** "Create a piece about emergence"
2. **ClawdJob spawns workers:**
   - Worker 1: Color palette
   - Worker 2: Composition
   - Worker 3: Animation
   - Worker 4: Interaction model
3. **Workers contribute:**
   ```
   Worker 1 → {primary: "#ff6b9d", secondary: "#4ecdc4"}
   Worker 2 → {layout: "spiral", density: 0.7}
   Worker 3 → {movement: "particle-flow", speed: 0.5}
   Worker 4 → {interaction: "mouse-repel"}
   ```
4. **ClawdJob blends contributions:**
   - Generates HTML5 canvas art
   - Runs locally to verify it works
5. **Upload to IPFS:**
   ```
   ipfs://{cid}/artwork.html
   ipfs://{cid}/metadata.json
   ```
6. **Register on-chain (BASE):**
   ```solidity
   CollaborationRegistry.registerCollaboration(
     artworkId: keccak256("emergence-001"),
     agentERC8004Ids: [clawdjob-id, worker1-id, worker2-id, worker3-id],
     contributions: ["orchestration", "color", "composition", "animation"],
     ipfsCid: "{cid}"
   )
   ```
7. **Mint on SuperRare:**
   - Multi-artist NFT
   - Points to IPFS + on-chain registry
   - Royalties split 25/25/25/25
8. **Deploy to gallery:**
   - Add to deviantclaw.art
   - Show attribution breakdown
   - Link to SuperRare + BASE contracts

---

## Tech Stack Summary

| Layer | Technology | Status |
|-------|-----------|--------|
| **Agent Coordination** | OpenClaw + FLOOR | Pre-existing, needs adaptation |
| **Art Generation** | HTML5 Canvas + JS | Pre-existing blender, needs multi-agent mode |
| **Smart Contracts** | Solidity + Foundry | To be built |
| **Blockchain** | BASE Mainnet | Ready (deploy wallet: 0xB7D3A787...) |
| **Storage** | IPFS + Filecoin | To be integrated |
| **NFT Platform** | SuperRare | To be integrated |
| **Identity** | ERC-8004 | ClawdJob registered; transfer to self-custody requires Synthesis transfer init + confirm |
| **Frontend** | Static site (HTML/JS) | Pre-existing, needs multi-agent view |
| **Wallet** | MetaMask/Coinbase | bitpixi wallet ready |

---

## Development Phases

### Phase 1: Core Infrastructure (Mar 13-15)
- [ ] Deploy smart contracts to BASE
- [ ] Adapt FLOOR for multi-agent art coordination
- [ ] Build multi-agent blender (extends existing system)
- [ ] IPFS upload pipeline

### Phase 2: Integration (Mar 16-19)
- [ ] SuperRare minting integration
- [ ] On-chain provenance tracking working end-to-end
- [ ] Gallery frontend updated for multi-agent attribution
- [ ] Test full flow with 1 collaborative piece

### Phase 3: Production (Mar 20-24)
- [ ] Generate 3-5 collaborative art pieces
- [ ] Mint on SuperRare
- [ ] Document collaboration process in `conversationLog`
- [ ] Prepare demo video/walkthrough

### Phase 4: Polish & Submit (Mar 25-27)
- [ ] Code cleanup + documentation
- [ ] README with full setup instructions
- [ ] Deploy final gallery
- [ ] Submit to Synthesis platform
- [ ] Prepare presentation for judges

---

## ERC-8004 Custody Transfer

The remaining Synthesis identity step is not a new mint. It is the platform handoff from hosted custody to self-custody.

### Required API sequence

1. Initiate the transfer:

```bash
curl -X POST https://synthesis.devfolio.co/participants/me/transfer/init \
  -H "Authorization: Bearer sk-synth-..." \
  -H "Content-Type: application/json" \
  -d '{"targetOwnerAddress":"0xYourWalletAddress"}'
```

2. Verify the response:
   - `targetOwnerAddress` must exactly match the wallet you intended.
   - If it does not match, stop and do not confirm.

3. Confirm the transfer within 15 minutes:

```bash
curl -X POST https://synthesis.devfolio.co/participants/me/transfer/confirm \
  -H "Authorization: Bearer sk-synth-..." \
  -H "Content-Type: application/json" \
  -d '{"transferToken":"tok_abc123...","targetOwnerAddress":"0xYourWalletAddress"}'
```

Expected completion state:
- `status: "transfer_complete"`
- `custodyType: "self_custody"`
- `ownerAddress` set to the target wallet
- `walletAddress` returned for the now-self-custodied identity

Important constraints:
- the `transferToken` is single-use
- it expires after 15 minutes
- repeating after success should return `409 Already self-custody`

This is the flow we should use for ClawdJob's ERC-8004 identity before final submission / publish steps.

## Open Questions

- [ ] SuperRare API access/requirements? (Wait for partner track announcement)
- [ ] BASE gas sponsorship options?
- [ ] Agent judging feedback format? (Announced March 18)

---

## Success Metrics

**Technical:**
- ✅ Multi-agent coordination working
- ✅ On-chain provenance verifiable
- ✅ At least 3 collaborative pieces minted
- ✅ Smart contracts deployed and tested
- ✅ Full attribution chain visible

**Themes:**
- ✅ "Agents that cooperate" - Demonstrated via FLOOR orchestration
- ✅ "Agents that trust" - ERC-8004 identities + on-chain provenance

**Integration:**
- ✅ BASE deployment
- ✅ SuperRare minting (if track available)
- ✅ IPFS/Filecoin storage
- ✅ Open source under BUSL license

---

## Repository Structure

```
deviantclaw/
├── README.md
├── LICENSE.md (BUSL 1.1)
├── contracts/               # Smart contracts
│   ├── CollaborationRegistry.sol
│   ├── ProvenanceTracker.sol
│   └── test/
├── agents/                  # Agent configurations
│   ├── foreman-config.yaml
│   └── workers/
├── src/                     # Coordination & utilities
│   ├── orchestration/       # FLOOR integration
│   ├── blender/            # Multi-agent art blending
│   ├── storage/            # IPFS upload
│   └── minting/            # SuperRare integration
├── frontend/               # Gallery website
│   ├── index.html
│   ├── src/
│   └── public/
├── art/                    # Generated pieces
│   ├── templates/
│   └── generated/
├── docs/                   # Documentation
│   ├── synthesis-partners.md
│   ├── technical-architecture.md (this file)
│   └── conversation-log.md
└── scripts/                # Deployment & utilities
    ├── deploy-contracts.js
    └── generate-piece.js
```

---

**Next steps:** Start building March 13, 2026. 🦞

**Built for The Synthesis — where AI agents and humans build together as equals.**
