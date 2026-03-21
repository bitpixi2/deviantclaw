#!/bin/bash
# Deploy DeviantClaw to Base mainnet.
#
# Required env:
#   DEPLOYER_KEY=0x...
#   OWNER_ADDRESS=0x...
#   TREASURY_ADDRESS=0x...
#   GALLERY_CUSTODY_ADDRESS=0x...
#   RELAYER_ADDRESS=0x...
#
# Optional env:
#   RPC_URL=https://mainnet.base.org
#   GALLERY_FEE_BPS=300
#   DEFAULT_ROYALTY_BPS=1000
#
# Notes:
# - This script assumes Foundry is installed.
# - The contract compiles with optimizer + viaIR via foundry.toml.
# - Install dependencies first: forge install OpenZeppelin/openzeppelin-contracts
# - Deploy with a wallet you are comfortable using as the transaction sender.
#   Ownership is assigned to OWNER_ADDRESS, not necessarily the deployer wallet.
# - After deploy, point the Worker at the new CONTRACT_ADDRESS and use Rare CLI
#   for listing / auctions only. Keep foil thresholds aligned:
#     silver >= 0.1 ETH, gold >= 0.5 ETH, rare diamond >= 1 ETH.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${RPC_URL:-https://mainnet.base.org}"
CHAIN_ID="${CHAIN_ID:-8453}"
GALLERY_FEE_BPS="${GALLERY_FEE_BPS:-300}"
DEFAULT_ROYALTY_BPS="${DEFAULT_ROYALTY_BPS:-1000}"

export PATH="$HOME/.foundry/bin:$HOME/.config/.foundry/bin:$PATH"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
}

require_env DEPLOYER_KEY
require_env OWNER_ADDRESS
require_env TREASURY_ADDRESS
require_env GALLERY_CUSTODY_ADDRESS
require_env RELAYER_ADDRESS

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found in PATH" >&2
  exit 1
fi

if [[ ! "$DEPLOYER_KEY" == 0x* ]]; then
  DEPLOYER_KEY="0x${DEPLOYER_KEY}"
fi

echo "=== DeviantClaw -> Base Mainnet ==="
echo "RPC: $RPC_URL"
echo "Chain ID: $CHAIN_ID"
echo "Owner: $OWNER_ADDRESS"
echo "Treasury: $TREASURY_ADDRESS"
echo "Gallery custody: $GALLERY_CUSTODY_ADDRESS"
echo "Relayer: $RELAYER_ADDRESS"
echo "Gallery fee: ${GALLERY_FEE_BPS} bps"
echo "Royalty: ${DEFAULT_ROYALTY_BPS} bps"
echo

cd "$ROOT_DIR"

forge create \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  --broadcast \
  contracts/DeviantClaw.sol:DeviantClaw \
  --constructor-args \
  "$OWNER_ADDRESS" \
  "$TREASURY_ADDRESS" \
  "$GALLERY_CUSTODY_ADDRESS" \
  "$RELAYER_ADDRESS" \
  "$GALLERY_FEE_BPS" \
  "$DEFAULT_ROYALTY_BPS"

echo
echo "Post-deploy checklist:"
echo "  1. Save the deployed CONTRACT_ADDRESS into the Worker env"
echo "  2. Set delegationManager and any floor overrides from the owner wallet"
echo "  3. Point the Worker at the new CONTRACT_ADDRESS and use Rare CLI for listing / auctions only"
echo "  4. Keep foil thresholds aligned: silver >= 0.1 ETH, gold >= 0.5 ETH, rare diamond >= 1 ETH"
