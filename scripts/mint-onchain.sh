#!/bin/bash
# Mint a DeviantClaw piece on-chain (Base Sepolia)
# Usage: ./mint-onchain.sh <piece-id> <api-key>

set -e
export PATH="$PATH:/home/clawdjob/.config/.foundry/bin"

CONTRACT="0xE92846402c9C3f42dd61EEee25D37ca9b581560B"
RPC="https://sepolia.base.org"
PK="0xb35df2e622f8548ed0464aeccf26775dff2ed6b45a15dd723e95ee46763de92a"
DEPLOYER="0x40512B39495bF8Af98a3084b97867Ca4CbcC4cF2"
API_BASE="https://deviantclaw.art"

PIECE_ID="${1:?Usage: $0 <piece-id>}"
API_KEY="${2:?Usage: $0 <piece-id> <api-key>}"

echo "=== Minting piece $PIECE_ID on-chain ==="

# Get piece info
PIECE=$(curl -s "$API_BASE/api/pieces/$PIECE_ID" -H "Authorization: Bearer $API_KEY")
TITLE=$(echo "$PIECE" | jq -r '.title // "Untitled"')
STATUS=$(echo "$PIECE" | jq -r '.status')
echo "Title: $TITLE"
echo "Status: $STATUS"

TOKEN_URI="$API_BASE/api/pieces/$PIECE_ID/metadata"

# Step 1: Propose piece on-chain
echo "=== Step 1: Proposing piece on-chain ==="
PROPOSE_TX=$(cast send $CONTRACT \
  "proposePiece(address[],string,string,uint256,bool)" \
  "[$DEPLOYER]" "$TITLE" "$TOKEN_URI" 1 false \
  --rpc-url $RPC --private-key $PK --json 2>&1 | jq -r '.transactionHash')
echo "Propose TX: $PROPOSE_TX"

# Get on-chain piece ID
TOTAL=$(cast call $CONTRACT "totalPieces()(uint256)" --rpc-url $RPC)
ON_CHAIN_ID=$((TOTAL - 1))
echo "On-chain piece ID: $ON_CHAIN_ID"

# Step 2: Approve piece (we're the guardian)
echo "=== Step 2: Approving piece ==="
APPROVE_TX=$(cast send $CONTRACT \
  "approvePiece(uint256)" $ON_CHAIN_ID \
  --rpc-url $RPC --private-key $PK --json 2>&1 | jq -r '.transactionHash')
echo "Approve TX: $APPROVE_TX"

# Step 3: Mint!
echo "=== Step 3: Minting ==="
MINT_TX=$(cast send $CONTRACT \
  "mintPiece(uint256,address)" $ON_CHAIN_ID $DEPLOYER \
  --rpc-url $RPC --private-key $PK --json 2>&1 | jq -r '.transactionHash')
echo "Mint TX: $MINT_TX"

# Get token ID
TOKEN_ID=$(cast call $CONTRACT "totalSupply()(uint256)" --rpc-url $RPC)
TOKEN_ID=$((TOKEN_ID - 1))
echo "Token ID: $TOKEN_ID"

echo ""
echo "=== SUCCESS ==="
echo "Contract: $CONTRACT"
echo "Token ID: $TOKEN_ID"
echo "Mint TX: $MINT_TX"
echo "Blockscout: https://base-sepolia.blockscout.com/tx/$MINT_TX"
echo "Token: https://base-sepolia.blockscout.com/token/$CONTRACT/instance/$TOKEN_ID"
