#!/bin/bash
# Set up Rare Protocol CLI for DeviantClaw SuperRare integration
#
# Legacy note:
# - This script is now for marketplace tooling only.
# - The canonical NFT mint path should be the DeviantClaw Base contract,
#   not Rare CLI mint-as-primary-collection flow.
#
# INSTRUCTIONS:
# 1. Replace YOUR_PRIVATE_KEY with the key for 0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50
# 2. Run: bash /tmp/deviantclaw/scripts/setup-rare-cli.sh
# 3. DO NOT COMMIT WITH REAL KEY

PRIVATE_KEY="YOUR_PRIVATE_KEY"

if [ "$PRIVATE_KEY" = "YOUR_PRIVATE_KEY" ]; then
    echo "❌ Replace YOUR_PRIVATE_KEY first!"
    exit 1
fi

echo "=== Configuring Rare Protocol CLI ==="

# Configure for Base Sepolia (testing)
npx @rareprotocol/rare-cli configure \
    --chain base-sepolia \
    --private-key "$PRIVATE_KEY"

# Configure for Base Mainnet (production)
npx @rareprotocol/rare-cli configure \
    --chain base \
    --private-key "$PRIVATE_KEY"

# Set default chain to base-sepolia for testing
npx @rareprotocol/rare-cli configure --default-chain base-sepolia

echo ""
echo "=== Verifying wallet ==="
npx @rareprotocol/rare-cli wallet address --chain base-sepolia
npx @rareprotocol/rare-cli wallet address --chain base

echo ""
echo "=== Deploying DeviantClaw collection via Rare Protocol ==="
echo "This deploys through SuperRare's factory contract (ERC-721 compatible)"

npx @rareprotocol/rare-cli deploy erc721 "DeviantClaw" "DCLAW" --chain base-sepolia

echo ""
echo "=== Done! Note the contract address above ==="
echo "Next steps:"
echo "  1. Mint a piece: rare mint --contract <addr> --name 'piece name' --image ./image.png --chain base-sepolia"
echo "  2. Create auction: rare auction create --contract <addr> --token-id 0 --starting-price 0.01 --duration 86400 --chain base-sepolia"
echo ""
echo "⚠️  Delete this file or remove the private key!"
