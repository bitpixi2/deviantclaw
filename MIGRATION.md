# DeviantClaw Migration Checklist

## New Wallet
- **Address**: `0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50`
- **Purpose**: All future deployments (replaces compromised `0x40512B...`)

## Old Wallet (COMPROMISED — DO NOT USE)
- `0x40512B39495bF8Af98a3084b97867Ca4CbcC4cF2`
- Private key was exposed via GitHub commit
- ~$22 drained by scraper bot on March 17, 2026

---

## Phase 1: Status Sepolia (gasless — do now)
- [ ] Deploy DeviantClaw contract to Status Sepolia from new wallet
- [ ] Verify contract on Status Sepolia explorer
- [ ] Register Phosphor agent on-chain
- [ ] Register Ember agent on-chain (address `0x1e8056A6EAed187125098180e43AacB8B5D700e2`, type: subagent)
- [ ] Mint Token #0: "machine's mundane dream" (Phosphor solo)
- [ ] Mint Token #1: "cracked platonic abyss" (Phosphor × Ember collab)
- [ ] Update Status Sepolia contract address in codebase

## Phase 2: Base Mainnet (needs ~$1 real ETH)
- [ ] Fund new wallet with Base mainnet ETH (~0.01 ETH should be enough)
- [ ] Deploy DeviantClaw contract to Base Mainnet
- [ ] Verify contract on Basescan
- [ ] Register Phosphor agent on-chain
- [ ] Register Ember agent on-chain
- [ ] Mint Token #0: "machine's mundane dream" (Phosphor solo)
- [ ] Mint Token #1: "cracked platonic abyss" (Phosphor × Ember collab)
- [ ] Update Base Mainnet contract address in codebase

## Phase 3: Code/Config Updates (after both deploys)
- [ ] Update contract addresses in `worker/index.js`
- [ ] Update deployer/treasury address references
- [ ] Update README with new contract addresses
- [ ] Update `/.well-known/agent.json` if it references old wallet
- [ ] Update Blockscout/explorer verification links
- [ ] Update hackathon submission draft with new addresses
- [ ] Commit + deploy to Cloudflare

## What Doesn't Need Migration
- ✅ ERC-8004 identity (Token #29812, Base Mainnet) — Devfolio custodial, unrelated
- ✅ Venice API key — Cloudflare Worker secret, never exposed
- ✅ All D1 database content — Cloudflare-hosted, wallet-independent
- ✅ Domain, DNS, Workers config — unrelated to wallet
- ✅ GitHub repo — compromised key already removed
- ✅ Kasey's main wallet (`0xb7d3a787...` / bitpixi.base.eth) — confirmed safe

## Funding Summary
| Chain | ETH Needed | Source |
|---|---|---|
| Status Sepolia | 0 (gasless) | N/A |
| Base Mainnet | ~0.01 ETH (~$25) | Transfer from Kasey's main wallet |
