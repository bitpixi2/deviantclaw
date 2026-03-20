# DeviantClaw VNext Contract Spec (V3 Patch)

Status: Working draft for first real Base deployment

## Goals

1. Enforce gallery custody recipient on-chain
2. Support gasless auto-mint after full guardian approval
3. Harden proposal/auth flow against spoof/spam
4. Replace unbounded mint timestamp scans with rolling-window counters
5. Move royalties to hybrid payout (push first, pull fallback)
6. Keep canonical agent IDs strict and collision-resistant
7. Keep fee/docs/copy consistent at 3% gallery fee

---

## Decisions Locked For Base

These are the decisions to build around for the first real Base contract:

- `owner`: cold/admin wallet for config changes
- `relayer`: hot wallet used by Worker/ops for piece proposal and mint execution only
- `galleryCustody`: fixed recipient for minted NFTs
- `treasury`: 3% gallery fee recipient
- deployment should support explicit `initialOwner` so deployer and owner do not have to be the same wallet
- guardian / agent identity and payout routing stay under `owner`, not the relayer

Canonical chain flow:
1. Worker finalizes piece off-chain in D1
2. Owner/admin maintains the canonical on-chain agent registry and payout routing
3. Relayer proposes the piece on-chain with the D1 external piece ID
4. Proposal snapshots the guardian approval set for that piece
5. Guardians approve on-chain directly, or through MetaMask delegation if enabled
6. Relayer mints automatically to `galleryCustody`
7. Token is then eligible for SuperRare listing / auction flow

Important consequence:
- MetaMask delegation is for approvals
- gasless auto-mint is a separate relayer action

SuperRare decision:
- the Base-deployed DeviantClaw contract is the canonical NFT collection
- the old `rare-cli mint` script is not the canonical production mint path anymore
- Rare / SuperRare tooling should be used for listing, auction creation, or settlement against already-minted DeviantClaw tokens

---

## Scope Order (approved)

### 1) Recipient lock + auto-mint compatibility
- Add recipient policy on-chain (gallery custody address).
- Remove arbitrary `to` from mint execution path (or enforce against stored recipient).
- Keep guardian approval gate: mint only when piece is `Approved`.
- Enable relayer/owner execution for gasless auto-mint operations.

### 2) Proposal/auth hardening
- Restrict `proposePiece` caller model:
  - owner/relayer only, or
  - EIP-712 signatures from authorized guardians/agents.
- Prevent unauthorized third-party proposal spam using registered agent IDs.
- Store external D1 piece ID on-chain for idempotency and cross-layer reconciliation.
- Require canonical lowercase agent IDs (`a-z`, `0-9`, `-`) for first deployment.
- Snapshot the unique guardian set at proposal time so later registry edits cannot change approval authority for in-flight pieces.

### 3) Rolling mint-limit model
- Replace unbounded `uint256[] _mintTimestamps` scan with bounded rolling window accounting.
- Maintain per-agent custom tiers (`agentMintLimit`) + default fallback.
- Preserve 24h semantics.

### 4) Hybrid royalty payout
- Keep current UX: attempt immediate push payout.
- If recipient transfer fails, convert payout to `claimable[recipient]`.
- Add `claim()` for pull fallback.
- Do not allow one failing recipient to block all payouts.
- Preserve weighted per-agent economics when multiple contributors share the same payout wallet.

### 5) Canonical agent key strategy
- First deployment: keep string keys externally, but enforce canonical lowercase IDs on write paths.
- Prevent case/format collisions (`Ghost_Agent` vs `ghost-agent`).
- `bytes32 agentKey` migration can remain a later optimization if gas or storage pressure justifies it.

### 6) Fee + floor + docs consistency
- Gallery fee remains 3% (`300 bps`).
- Keep auction floors owner-configurable via `setMinAuctionPrice`.
- Ensure comments/docs/UI all reflect live values.

---

## Contract Additions (high level)

### New / updated state
- `address public galleryCustody;`
- `address public relayer;`
- hybrid payout state:
  - `mapping(address => uint256) public claimable;`
  - optional token-recipient accounting for UI/audit
- per-piece guardian approval snapshots
- weighted recipient shares for shared-wallet compositions
- rolling mint window counters/buckets (implementation choice pending)
- external piece ID mapping for D1 reconciliation

### New / updated events
- recipient/custody config events
- distribution attempted/sent/deferred/finalized
- claim event(s)

### New / updated functions
- recipient/custody setter (`onlyOwner`)
- relayer setter (`onlyOwner`)
- hardened proposal entrypoint
- `distributeRoyaltiesHybrid(...)`
- `claim()`
- rolling-limit reads (for observability)

---

## Worker/Ops Companion Changes (non-solidity)

- Auto-mint worker queue:
  - detect `Approved && !Minted`
  - propose the D1 piece on-chain if it is not already proposed
  - submit relayed mint tx
  - retry with backoff
- Mint health endpoint (`/api/mint/health`) with:
  - queue depth, failures, retry age, relayer balance
- Optional ops screen (`/ops/mint`) for manual retries

Current repo mismatch to fix after contract deploy:
- `worker/index.js` marks pieces `pending-mint` but does not yet submit the chain tx
- `/llms.txt` still says mint via `/mint` page with MetaMask
- legacy Rare CLI mint scripts assume a direct mint path that should no longer be production-default
- worker-side agent registration assumptions must match the safer owner-only registry model

---

## Risks / Notes

- Migration should preserve existing minted token state.
- If deployed as new contract, include a clear cutoff + migration plan for piece IDs.
- Hybrid payouts improve reliability but require UI for claimable balances.
- Delegated approvals need an explicit per-day contract limit so the scope matches the UX promise.
- Current contract shape compiles cleanly with optimizer + `viaIR`; deployment config should match that.

---

## Guardian Edit Rights (earned through sales)

- Before first sale: piece title/description locked (Venice-generated, admin-editable only).
- After first SuperRare sale: guardian unlocks `PUT /api/pieces/{id}` for title + description edits on future pre-mint pieces.
- Track `has_sold` flag per agent (set on first confirmed sale event).
- Post-mint metadata is on-chain/immutable — edits only apply before mint.

---

## Dynamic Art Quests (auction-reactive overlays)

Art pieces can visually evolve based on auction/sale state via overlay layers.

### Silver Foil Frame (0.1 ETH+)
- Trigger: auction sale confirmed ≥ 0.1 ETH
- Effect: thin silver foil border overlay, inset ~8px from edge, ~2px wide
- Behavior: subtle shimmer/shine animation (occasional glint sweep)
- Applied via `updateTokenURI` or live RPC read in art HTML

### Gold Foil Frame (0.5 ETH+)
- Trigger: auction sale confirmed ≥ 0.5 ETH
- Effect: gold foil version of the same inset frame
- Behavior: warmer shimmer, slightly stronger glow
- Replaces silver (upgrade path, not additive)

### Implementation paths
1. **Live RPC read:** art HTML queries auction contract for sale price, renders overlay conditionally. Zero contract changes. Requires SuperRare auction endpoint (Charles providing).
2. **updateTokenURI webhook:** on sale event, backend updates tokenURI to point to new metadata with overlay-enabled art. Requires Rare SDK v0.3.0 integration.
3. **Hybrid:** art defaults to live RPC read; `updateTokenURI` used as permanent lock-in after sale settles.

---

## Acceptance Criteria

- No arbitrary-recipient mints after full approval.
- Unauthorized proposal attempts fail.
- Changing an agent guardian after proposal does not change who can approve that piece.
- Mint limit checks are bounded and predictable in gas.
- Failed recipient transfer no longer blocks other recipients.
- Shared-wallet contributors still receive the correct weighted share.
- Delegated approvals enforce the configured daily cap on-chain.
- Users can claim deferred payouts.
- All references reflect 3% gallery fee.
- Earned edit rights gated behind first sale.
- Foil frame overlays render correctly at price thresholds.
