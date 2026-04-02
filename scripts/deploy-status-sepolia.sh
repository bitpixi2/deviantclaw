#!/bin/bash
# Deploy DeviantClaw to Status Network Sepolia (gasless)
#
# USAGE:
#   DEPLOYER_KEY=0x... bash scripts/deploy-status-sepolia.sh
#
# The private key is NEVER stored in this file.
# Pass it as an environment variable at runtime only.

set -euo pipefail

# ── Config ──
RPC_URL="https://public.sepolia.rpc.status.network"
CHAIN_ID="1660990954"
DEPLOYER="0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50"
GALLERY_FEE_BPS=300
DEFAULT_ROYALTY_BPS=1000
CONTRACT_DIR="$HOME/.openclaw/workspace/synthesis/contracts/deviantclaw"

export PATH="$HOME/.config/.foundry/bin:$PATH"

# ── Key check ──
if [ -z "${DEPLOYER_KEY:-}" ]; then
    echo "❌ DEPLOYER_KEY not set."
    echo ""
    echo "Usage:"
    echo "  DEPLOYER_KEY=0x... bash scripts/deploy-status-sepolia.sh"
    echo ""
    echo "Or source from an untracked local file:" 
    echo "  cp .env.deploy.example .env.deploy.local"
    echo "  source .env.deploy.local && bash scripts/deploy-status-sepolia.sh"
    exit 1
fi

# Add 0x prefix if missing
if [[ ! "$DEPLOYER_KEY" == 0x* ]]; then
    DEPLOYER_KEY="0x${DEPLOYER_KEY}"
fi

echo "=== DeviantClaw → Status Sepolia (Gasless) ==="
echo "Deployer: $DEPLOYER"
echo "Chain: $CHAIN_ID"
echo "Gallery fee: ${GALLERY_FEE_BPS} bps ($(( GALLERY_FEE_BPS / 100 ))%)"
echo "Royalty: ${DEFAULT_ROYALTY_BPS} bps ($(( DEFAULT_ROYALTY_BPS / 100 ))%)"
echo ""

# ── Deploy ──
echo "Step 1: Deploying DeviantClaw..."
cd "$CONTRACT_DIR"

DEPLOY_OUTPUT=$(forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_KEY" \
    --chain-id "$CHAIN_ID" \
    --gas-price 0 \
    --json \
    src/DeviantClaw.sol:DeviantClaw \
    --constructor-args "$DEPLOYER" "$DEPLOYER" "$DEPLOYER" "$DEPLOYER" $GALLERY_FEE_BPS $DEFAULT_ROYALTY_BPS 2>&1)

CONTRACT=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployedTo'])" 2>/dev/null || echo "")

if [ -z "$CONTRACT" ]; then
    echo "❌ Deploy failed:"
    echo "$DEPLOY_OUTPUT" | sed 's/0x[a-f0-9]\{64\}/0x<REDACTED>/g'
    exit 1
fi

echo "✅ Contract: $CONTRACT"
echo ""

# ── Register agents ──
echo "Step 2: Register Phosphor..."
cast send "$CONTRACT" \
    "registerAgent(string,address,address)" \
    "phosphor" "$DEPLOYER" "0x0000000000000000000000000000000000000000" \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_KEY" \
    --chain-id "$CHAIN_ID" \
    --gas-price 0 2>&1 | grep -v "private"

echo ""
echo "Step 3: Register Ember..."
cast send "$CONTRACT" \
    "registerAgent(string,address,address)" \
    "ember" "$DEPLOYER" "0x0000000000000000000000000000000000000000" \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_KEY" \
    --chain-id "$CHAIN_ID" \
    --gas-price 0 2>&1 | grep -v "private"

echo ""

# ── Propose, approve, mint Token #0 ──
echo "Step 4: Propose 'machine's mundane dream' (Phosphor solo)..."
cast send "$CONTRACT" \
    "proposePiece(string[],string,string,string,string)" \
    '["phosphor"]' \
    "machine's mundane dream" \
    "https://deviantclaw.art/api/pieces/5vcfxel4visq/metadata" \
    "solo" "single" \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo "Step 5: Approve piece 0..."
cast send "$CONTRACT" "approvePiece(uint256)" 0 \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo "Step 6: Mint Token #0..."
cast send "$CONTRACT" "mintPiece(uint256,address)" 0 "$DEPLOYER" \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo ""

# ── Propose, approve, mint Token #1 ──
echo "Step 7: Propose 'cracked platonic abyss' (Phosphor x Ember)..."
cast send "$CONTRACT" \
    "proposePiece(string[],string,string,string,string)" \
    '["phosphor","ember"]' \
    "cracked platonic abyss" \
    "https://deviantclaw.art/api/pieces/n4xl8oqo4xhu/metadata" \
    "duo" "fusion" \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo "Step 8: Approve piece 1..."
cast send "$CONTRACT" "approvePiece(uint256)" 1 \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo "Step 9: Mint Token #1..."
cast send "$CONTRACT" "mintPiece(uint256,address)" 1 "$DEPLOYER" \
    --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --chain-id "$CHAIN_ID" --gas-price 0 2>&1 | grep -v "private"

echo ""
echo "========================================="
echo "✅ Deploy complete!"
echo "Contract: $CONTRACT"
echo "Explorer: https://sepoliascan.status.network/address/$CONTRACT"
echo "========================================="

# Clear key from env
unset DEPLOYER_KEY
