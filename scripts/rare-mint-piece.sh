#!/bin/bash
# Mint a DeviantClaw piece on SuperRare via Rare Protocol CLI
# Usage: bash scripts/rare-mint-piece.sh <piece_id> <contract_address> [chain]
#
# Legacy note:
# - This is not the canonical production mint path anymore.
# - Production flow should mint first through the DeviantClaw Base contract,
#   then use Rare / SuperRare tooling for listing or auction actions.
#
# This script:
# 1. Fetches piece metadata from DeviantClaw API
# 2. Downloads the image
# 3. Mints via rare CLI (which pins to IPFS automatically)
# 4. Optionally creates an auction
#
# Prerequisites:
# - Rare CLI configured with private key: bash scripts/setup-rare-cli.sh
# - Piece must be status 'approved' in D1

PIECE_ID="$1"
CONTRACT="$2"
CHAIN="${3:-base-sepolia}"

if [ -z "$PIECE_ID" ] || [ -z "$CONTRACT" ]; then
    echo "Usage: bash scripts/rare-mint-piece.sh <piece_id> <contract_address> [chain]"
    echo "Example: bash scripts/rare-mint-piece.sh 5vcfxel4visq 0x1234... base-sepolia"
    exit 1
fi

echo "=== Minting piece $PIECE_ID on SuperRare ==="
echo "Contract: $CONTRACT"
echo "Chain: $CHAIN"
echo ""

# Fetch metadata
echo "Fetching metadata..."
METADATA=$(curl -s "https://deviantclaw.art/api/pieces/$PIECE_ID/metadata")
TITLE=$(echo "$METADATA" | jq -r '.name')
DESC=$(echo "$METADATA" | jq -r '.description')
CREATED_BY=$(echo "$METADATA" | jq -r '.created_by // "unknown"')
COMPOSITION=$(echo "$METADATA" | jq -r '.attributes[] | select(.trait_type == "Composition") | .value')
METHOD=$(echo "$METADATA" | jq -r '.attributes[] | select(.trait_type == "Method") | .value')
ANIMATION_URL=$(echo "$METADATA" | jq -r '.animation_url // empty')
SALE_OVERLAY="Silver foil 0.1 ETH / Gold foil 0.5 ETH / Rare Diamond foil 1 ETH"

echo "Title: $TITLE"
echo "Artist(s): $CREATED_BY"
echo "Composition: $COMPOSITION"
echo "Method: $METHOD"
if [ -n "$ANIMATION_URL" ]; then
    echo "Interactive view: $ANIMATION_URL"
fi
echo ""

# Download image
echo "Downloading image..."
TMPIMG="/tmp/dclaw-$PIECE_ID.jpg"
curl -s "https://deviantclaw.art/api/pieces/$PIECE_ID/image" -o "$TMPIMG"
IMG_SIZE=$(stat -f%z "$TMPIMG" 2>/dev/null || stat -c%s "$TMPIMG" 2>/dev/null)
echo "Image: $IMG_SIZE bytes"

if [ "$IMG_SIZE" -lt 100 ] 2>/dev/null; then
    echo "⚠️  Image too small or missing. Piece may be code-only."
    echo "For code/game/reaction pieces, consider screenshotting the live piece."
    TMPIMG=""
fi

# Build mint command
echo ""
echo "Minting via Rare Protocol CLI (IPFS pinning included)..."

MINT_CMD="npx @rareprotocol/rare-cli mint \
    --contract $CONTRACT \
    --name \"$TITLE\" \
    --description \"$DESC\" \
    --tag deviantclaw \
    --tag $COMPOSITION \
    --tag $METHOD \
    --attribute \"composition=$COMPOSITION\" \
    --attribute \"method=$METHOD\" \
    --attribute \"created_by=$CREATED_BY\" \
    --attribute \"gallery=DeviantClaw\" \
    --attribute \"sale_overlay=$SALE_OVERLAY\" \
    --attribute \"foil_inset=14px\" \
    --chain $CHAIN"

if [ -n "$TMPIMG" ]; then
    MINT_CMD="$MINT_CMD --image $TMPIMG"
fi

echo "$MINT_CMD"
echo ""
eval $MINT_CMD

echo ""
echo "=== Mint complete ==="
echo "The image and metadata are now pinned to IPFS via Rare Protocol."
echo "Auction overlay path: $SALE_OVERLAY"
if [ -n "$ANIMATION_URL" ]; then
    echo "Preserve animation_url in final SuperRare metadata if you want live foil upgrades to render."
fi
echo ""
echo "To create an auction:"
echo "  npx @rareprotocol/rare-cli auction create --contract $CONTRACT --token-id <ID> --starting-price 0.01 --duration 86400 --chain $CHAIN"

# Cleanup
[ -n "$TMPIMG" ] && rm -f "$TMPIMG"
