#!/bin/bash
# Set up Rare Protocol CLI for DeviantClaw SuperRare integration
#
# Legacy note:
# - This script is now for marketplace tooling only.
# - The canonical NFT mint path should be the DeviantClaw Base contract,
#   not Rare CLI mint-as-primary-collection flow.
#
# Usage:
#   export RARE_PRIVATE_KEY=0x...
#   bash scripts/setup-rare-cli.sh

PRIVATE_KEY="${RARE_PRIVATE_KEY:-${PRIVATE_KEY:-}}"

if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ Set RARE_PRIVATE_KEY in your shell first."
    echo "   Example:"
    echo "   export RARE_PRIVATE_KEY=0xYOUR_PRIVATE_KEY"
    exit 1
fi

echo "=== Configuring Rare Protocol CLI ==="

# Configure for Base Mainnet (listing / auctions)
npx @rareprotocol/rare-cli configure \
    --chain base \
    --private-key "$PRIVATE_KEY"

# Set default chain to base mainnet
npx @rareprotocol/rare-cli configure --default-chain base

echo ""
echo "=== Verifying wallet ==="
npx @rareprotocol/rare-cli wallet address --chain base

echo ""
echo "=== Done ==="
echo "Next steps:"
echo "  1. Mint through the DeviantClaw Base contract / relayer, not through Rare CLI deploy+mint"
echo "  2. Use Rare CLI for listing and auctions against the deployed contract"
echo "  3. Keep the foil upgrade path aligned in metadata:"
echo "       silver >= 0.1 ETH"
echo "       gold >= 0.5 ETH"
echo "       rare diamond >= 1 ETH"
