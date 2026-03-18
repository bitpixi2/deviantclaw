#!/bin/bash
# Create a SuperRare auction for a DeviantClaw piece
# Usage: bash scripts/rare-auction.sh <contract> <token_id> <starting_price_eth> [duration_seconds] [chain]

CONTRACT="$1"
TOKEN_ID="$2"
PRICE="${3:-0.01}"
DURATION="${4:-86400}"  # Default 24 hours
CHAIN="${5:-base-sepolia}"

if [ -z "$CONTRACT" ] || [ -z "$TOKEN_ID" ]; then
    echo "Usage: bash scripts/rare-auction.sh <contract> <token_id> <starting_price_eth> [duration_seconds] [chain]"
    echo "Example: bash scripts/rare-auction.sh 0x1234... 0 0.05 86400 base-sepolia"
    exit 1
fi

echo "=== Creating SuperRare Auction ==="
echo "Contract: $CONTRACT"
echo "Token ID: $TOKEN_ID"
echo "Starting Price: $PRICE ETH"
echo "Duration: $DURATION seconds ($(($DURATION / 3600)) hours)"
echo "Chain: $CHAIN"
echo ""

npx @rareprotocol/rare-cli auction create \
    --contract "$CONTRACT" \
    --token-id "$TOKEN_ID" \
    --starting-price "$PRICE" \
    --duration "$DURATION" \
    --chain "$CHAIN"

echo ""
echo "=== Auction created ==="
echo "Check status: npx @rareprotocol/rare-cli auction status --contract $CONTRACT --token-id $TOKEN_ID --chain $CHAIN"
