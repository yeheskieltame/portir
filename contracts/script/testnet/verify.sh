#!/usr/bin/env bash
# usage: script/testnet/verify.sh   (needs ETHERSCAN_API_KEY in contracts/.env; reads deployments/testnet.json + the broadcast)
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] && { set -a; source .env; set +a; }
: "${ETHERSCAN_API_KEY:?set ETHERSCAN_API_KEY in contracts/.env}"
chain=97
run="broadcast/DeployTestnet.s.sol/$chain/run-latest.json"
usdt=$(jq -r .usdt deployments/testnet.json)
exchange=$(jq -r .exchange deployments/testnet.json)
keeper=$(jq -r .keeper deployments/testnet.json)

verified() { curl -s "https://api.etherscan.io/v2/api?chainid=$chain&module=contract&action=getabi&address=$1&apikey=$ETHERSCAN_API_KEY" | jq -e '.status == "1"' >/dev/null; }

verified "$usdt" || forge verify-contract "$usdt" src/testnet/MockUSDT.sol:MockUSDT --chain $chain --watch
verified "$exchange" || forge verify-contract "$exchange" src/testnet/TestExchange.sol:TestExchange --chain $chain --watch \
  --constructor-args "$(cast abi-encode "constructor(address,address,uint16)" "$usdt" "$keeper" 10)"

# MockStocks are created by TestExchange.addStock (deploy + later AddStocks runs): constructor args come from those calls.
jq -r '.transactions[] | select(.function != null and (.function | startswith("addStock"))) | [.arguments[0], .arguments[1], .arguments[2]] | @tsv' \
  "$run" broadcast/AddStocks.s.sol/$chain/run-latest.json 2>/dev/null |
while IFS=$'\t' read -r name symbol ticker; do
  stock=$(jq -r --arg t "$ticker" '.stocks[$t]' deployments/testnet.json)
  verified "$stock" && continue
  forge verify-contract "$stock" src/testnet/MockStock.sol:MockStock --chain $chain --watch \
    --constructor-args "$(cast abi-encode "constructor(string,string,string,address)" "$name" "$symbol" "$ticker" "$exchange")"
done
