// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";
import {TestExchange} from "../../src/testnet/TestExchange.sol";

/// Testnet fixtures: tUSDT with a faucet, the TestExchange, and one MockStock per featured ticker.
/// KEEPER (optional): who may push prices; defaults to the deployer. Writes deployments/testnet.json.
contract DeployTestnet is Script {
    string[8] internal tickers = ["NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "QQQ", "SPY"];
    string[8] internal names = [
        "NVIDIA (test)",
        "Tesla (test)",
        "Apple (test)",
        "Microsoft (test)",
        "Alphabet (test)",
        "Amazon (test)",
        "Nasdaq 100 ETF (test)",
        "S&P 500 ETF (test)"
    ];

    function run() external {
        address keeper = vm.envOr("KEEPER", msg.sender);
        vm.startBroadcast();
        MockUSDT usdt = new MockUSDT();
        TestExchange exchange = new TestExchange(usdt, keeper, 10);
        string memory json = "deploy";
        vm.serializeAddress(json, "usdt", address(usdt));
        vm.serializeAddress(json, "exchange", address(exchange));
        vm.serializeAddress(json, "keeper", keeper);
        string memory stocks = "stocks";
        string memory out;
        for (uint256 i = 0; i < tickers.length; i++) {
            address stock = exchange.addStock(names[i], string.concat(tickers[i], "t"), tickers[i]);
            out = vm.serializeAddress(stocks, tickers[i], stock);
            console.log(tickers[i], stock);
        }
        vm.stopBroadcast();
        out = vm.serializeString(json, "stocks", out);
        vm.writeJson(out, "deployments/testnet.json");
        console.log("tUSDT:", address(usdt));
        console.log("TestExchange:", address(exchange));
    }
}
