#!/bin/bash
# Create a SuperRare auction for a DeviantClaw piece
# Usage: bash scripts/rare-auction.sh <contract> <token_id> <starting_price_eth> [duration_seconds] [chain]

set -euo pipefail

CONTRACT="$1"
TOKEN_ID="$2"
PRICE="${3:-0.01}"
DURATION="${4:-86400}"  # Default 24 hours
CHAIN="${5:-base}"

if [ -z "$CONTRACT" ] || [ -z "$TOKEN_ID" ]; then
    echo "Usage: bash scripts/rare-auction.sh <contract> <token_id> <starting_price_eth> [duration_seconds] [chain]"
    echo "Example: bash scripts/rare-auction.sh 0x1234... 0 0.05 86400 base"
    exit 1
fi

echo "=== Creating SuperRare Auction ==="
echo "Contract: $CONTRACT"
echo "Token ID: $TOKEN_ID"
echo "Starting Price: $PRICE ETH"
echo "Duration: $DURATION seconds ($(($DURATION / 3600)) hours)"
echo "Chain: $CHAIN"
echo ""
echo "Foil thresholds:"
echo "  silver >= 0.1 ETH"
echo "  gold >= 0.5 ETH"
echo "  rare diamond >= 1 ETH"
echo ""

set +e
AUCTION_OUTPUT="$(npx @rareprotocol/rare-cli auction create \
    --contract "$CONTRACT" \
    --token-id "$TOKEN_ID" \
    --starting-price "$PRICE" \
    --duration "$DURATION" \
    --chain "$CHAIN" 2>&1)"
AUCTION_STATUS=$?
set -e

echo "$AUCTION_OUTPUT"

if [ "$AUCTION_STATUS" -ne 0 ]; then
    echo ""
    echo "=== Auction failed ==="
    if echo "$AUCTION_OUTPUT" | grep -qi "nonce provided for the transaction is lower"; then
        echo "Rare CLI used a stale nonce for the seller wallet."
        echo "Wait a few seconds and run the same command again, or check the current nonce with:"
        echo "  cast nonce 0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50 --rpc-url \${BASE_RPC:-https://mainnet.base.org}"
    fi
    exit "$AUCTION_STATUS"
fi

echo ""
echo "=== Auction created ==="
echo "Check status: npx @rareprotocol/rare-cli auction status --contract $CONTRACT --token-id $TOKEN_ID --chain $CHAIN"
