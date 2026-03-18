#!/bin/bash
# Deploy DeviantClaw to Status Network Sepolia (gasless)
# 
# INSTRUCTIONS:
# 1. Replace YOUR_PRIVATE_KEY below with the private key for 0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50
# 2. Run: bash /tmp/deviantclaw/scripts/deploy-status-sepolia.sh
# 3. DO NOT COMMIT THIS FILE WITH A REAL KEY

PRIVATE_KEY="YOUR_PRIVATE_KEY"
RPC_URL="https://public.sepolia.rpc.status.network"
CHAIN_ID="1660990954"
DEPLOYER="0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50"

# Gallery fee: 3% (300 bps), Default royalty: 10% (1000 bps)
GALLERY_FEE_BPS=300
DEFAULT_ROYALTY_BPS=1000

CONTRACT_DIR="$HOME/.openclaw/workspace/synthesis/contracts/deviantclaw"

echo "=== DeviantClaw → Status Sepolia Deploy ==="
echo "Deployer: $DEPLOYER"
echo "RPC: $RPC_URL"
echo "Chain: $CHAIN_ID"
echo ""

if [ "$PRIVATE_KEY" = "YOUR_PRIVATE_KEY" ]; then
    echo "❌ ERROR: Replace YOUR_PRIVATE_KEY in this script first!"
    echo "   Open this file and paste your private key on line 10"
    exit 1
fi

export PATH="$HOME/.config/.foundry/bin:$PATH"

echo "Step 1: Deploying DeviantClaw contract..."
cd "$CONTRACT_DIR"

DEPLOY_OUTPUT=$(forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" \
    --constructor-args "$DEPLOYER" $GALLERY_FEE_BPS $DEFAULT_ROYALTY_BPS \
    --json \
    src/DeviantClawV2.sol:DeviantClawV2 2>&1)

echo "$DEPLOY_OUTPUT"

# Extract contract address
CONTRACT=$(echo "$DEPLOY_OUTPUT" | grep -o '"deployedTo":"[^"]*"' | cut -d'"' -f4)

if [ -z "$CONTRACT" ]; then
    echo ""
    echo "❌ Deploy failed. If Status RPC is unreachable via Node, try curl-based approach."
    echo "   Check: curl -s -X POST $RPC_URL -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}'"
    exit 1
fi

echo ""
echo "✅ Contract deployed at: $CONTRACT"
echo ""
echo "Step 2: Register Phosphor agent..."

# Register Phosphor (guardian = deployer, no agent wallet yet)
# registerAgent(string agentId, address guardian, address agentWallet)
cast send "$CONTRACT" \
    "registerAgent(string,address,address)" \
    "phosphor" "$DEPLOYER" "0x0000000000000000000000000000000000000000" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 3: Register Ember agent..."

# Register Ember (subagent, guardian = deployer, agent has own wallet)
cast send "$CONTRACT" \
    "registerAgent(string,address,address)" \
    "ember" "$DEPLOYER" "0x1e8056A6EAed187125098180e43AacB8B5D700e2" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 4: Propose Token #0 — 'machine's mundane dream' (Phosphor solo)..."

# proposePiece(string[] agentIds, string title, string uri, string composition, string method)
cast send "$CONTRACT" \
    "proposePiece(string[],string,string,string,string)" \
    "[\"phosphor\"]" \
    "machine's mundane dream" \
    "https://deviantclaw.art/api/pieces/5vcfxel4visq/metadata" \
    "solo" \
    "single" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 5: Approve piece 0 (owner is guardian)..."

cast send "$CONTRACT" \
    "approvePiece(uint256)" \
    0 \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 6: Mint Token #0..."

# mintPiece(uint256 pieceId, address to)
cast send "$CONTRACT" \
    "mintPiece(uint256,address)" \
    0 "$DEPLOYER" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 7: Propose Token #1 — 'cracked platonic abyss' (Phosphor × Ember collab)..."

cast send "$CONTRACT" \
    "proposePiece(string[],string,string,string,string)" \
    "[\"phosphor\",\"ember\"]" \
    "cracked platonic abyss" \
    "https://deviantclaw.art/api/pieces/n4xl8oqo4xhu/metadata" \
    "duo" \
    "fusion" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 8: Approve piece 1 (owner is guardian for both agents)..."

cast send "$CONTRACT" \
    "approvePiece(uint256)" \
    1 \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "Step 9: Mint Token #1..."

cast send "$CONTRACT" \
    "mintPiece(uint256,address)" \
    1 "$DEPLOYER" \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --chain-id "$CHAIN_ID" 2>&1

echo ""
echo "========================================="
echo "✅ Migration complete!"
echo "Contract: $CONTRACT"
echo "Chain: Status Network Sepolia ($CHAIN_ID)"
echo "Explorer: https://sepoliascan.status.network/address/$CONTRACT"
echo "========================================="
echo ""
echo "⚠️  NOW: Delete this file or remove the private key!"
