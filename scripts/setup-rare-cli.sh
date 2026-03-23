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

set -euo pipefail

PRIVATE_KEY_RAW="${RARE_PRIVATE_KEY:-${DEPLOYER_KEY:-${PRIVATE_KEY:-}}}"
PRIVATE_KEY="$(printf '%s' "$PRIVATE_KEY_RAW" | tr -d '[:space:]')"
BASE_RPC_URL="${BASE_RPC:-https://mainnet.base.org}"
EXPECTED_OWNER="${RARE_EXPECTED_OWNER:-0xEc11EEa22DCaA37A31b441FB7d2b503e842F6E50}"

if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ Set RARE_PRIVATE_KEY in your shell first."
    echo "   Example:"
    echo "   export RARE_PRIVATE_KEY=0xYOUR_PRIVATE_KEY"
    exit 1
fi

if ! printf '%s' "$PRIVATE_KEY" | grep -Eq '^0x[0-9a-fA-F]{64}$'; then
    echo "❌ Rare CLI private key is malformed."
    echo "   Expected: 0x + 64 hex characters"
    echo "   Got length: ${#PRIVATE_KEY}"
    exit 1
fi

DERIVED_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"
DERIVED_ADDRESS_LC="$(printf '%s' "$DERIVED_ADDRESS" | tr '[:upper:]' '[:lower:]')"
EXPECTED_OWNER_LC="$(printf '%s' "$EXPECTED_OWNER" | tr '[:upper:]' '[:lower:]')"

echo "=== Configuring Rare Protocol CLI ==="
echo "Derived signer: $DERIVED_ADDRESS"
echo "Expected custody owner: $EXPECTED_OWNER"
if [ "$DERIVED_ADDRESS_LC" != "$EXPECTED_OWNER_LC" ]; then
    echo "⚠️  Signer does not match the current Base custody owner."
    echo "   Rare CLI auctions should be created by the wallet that owns the token."
fi

# Configure for Base Mainnet (listing / auctions)
npx @rareprotocol/rare-cli configure \
    --chain base \
    --private-key "$PRIVATE_KEY" \
    --rpc-url "$BASE_RPC_URL"

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
