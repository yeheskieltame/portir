#!/usr/bin/env bash
# usage: script/verify.sh <rpc alias> <proxy address>   (needs ETHERSCAN_API_KEY in contracts/.env)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; source .env; set +a; }
: "${ETHERSCAN_API_KEY:?set ETHERSCAN_API_KEY in contracts/.env}"
rpc=$1 proxy=$2
chain=$(cast chain-id --rpc-url "$rpc")
impl=$(cast implementation "$proxy" --rpc-url "$rpc")
forge verify-contract "$impl" src/PlanRegistry.sol:PlanRegistry --chain "$chain" --watch
# Constructor args come from the deploy broadcast: guessing them needs a paid Etherscan endpoint on BSC.
read -r a0 a1 < <(jq -r '.transactions[] | select(.contractName=="ERC1967Proxy") | .arguments | join(" ")' \
  "broadcast/Deploy.s.sol/$chain/run-latest.json")
forge verify-contract "$proxy" \
  lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --chain "$chain" --constructor-args "$(cast abi-encode "constructor(address,bytes)" "$a0" "$a1")" --watch
