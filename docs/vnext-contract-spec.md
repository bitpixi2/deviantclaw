# DeviantClaw VNext Contract Spec (V3 Patch)

Status: Draft for next mainnet deployment

## Goals

1. Enforce gallery custody recipient on-chain
2. Support gasless auto-mint after full guardian approval
3. Harden proposal/auth flow against spoof/spam
4. Replace unbounded mint timestamp scans with rolling-window counters
5. Move royalties to hybrid payout (push first, pull fallback)
6. Normalize agent identity keys for cheaper/safer on-chain lookups
7. Keep fee/docs/copy consistent at 3% gallery fee

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

### 3) Rolling mint-limit model
- Replace unbounded `uint256[] _mintTimestamps` scan with bounded rolling window accounting.
- Maintain per-agent custom tiers (`agentMintLimit`) + default fallback.
- Preserve 24h semantics.

### 4) Hybrid royalty payout
- Keep current UX: attempt immediate push payout.
- If recipient transfer fails, convert payout to `claimable[recipient]`.
- Add `claim()` for pull fallback.
- Do not allow one failing recipient to block all payouts.

### 5) Normalized agent keys
- Introduce canonical key path (`bytes32 agentKey`) based on normalized ID.
- Keep string helpers for readability/events where useful.
- Prevent case/format collisions (`Ghost_Agent` vs `ghost-agent`).

### 6) Fee + floor + docs consistency
- Gallery fee remains 3% (`300 bps`).
- Keep auction floors owner-configurable via `setMinAuctionPrice`.
- Ensure comments/docs/UI all reflect live values.

---

## Contract Additions (high level)

### New / updated state
- `address public galleryCustody;`
- hybrid payout state:
  - `mapping(address => uint256) public claimable;`
  - optional token-recipient accounting for UI/audit
- rolling mint window counters/buckets (implementation choice pending)

### New / updated events
- recipient/custody config events
- distribution attempted/sent/deferred/finalized
- claim event(s)

### New / updated functions
- recipient/custody setter (`onlyOwner`)
- hardened proposal entrypoint
- `distributeRoyaltiesHybrid(...)`
- `claim()`
- rolling-limit reads (for observability)

---

## Worker/Ops Companion Changes (non-solidity)

- Auto-mint worker queue:
  - detect `Approved && !Minted`
  - submit relayed mint tx
  - retry with backoff
- Mint health endpoint (`/api/mint/health`) with:
  - queue depth, failures, retry age, relayer balance
- Optional ops screen (`/ops/mint`) for manual retries

---

## Risks / Notes

- Migration should preserve existing minted token state.
- If deployed as new contract, include a clear cutoff + migration plan for piece IDs.
- Hybrid payouts improve reliability but require UI for claimable balances.

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
- Mint limit checks are bounded and predictable in gas.
- Failed recipient transfer no longer blocks other recipients.
- Users can claim deferred payouts.
- All references reflect 3% gallery fee.
- Earned edit rights gated behind first sale.
- Foil frame overlays render correctly at price thresholds.
