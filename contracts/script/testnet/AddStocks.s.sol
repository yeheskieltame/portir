// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TestExchange} from "../../src/testnet/TestExchange.sol";

/// Adds any missing MockStock to the deployed TestExchange (idempotent) and rewrites deployments/testnet.json.
/// The list is every ticker the app features or puts in a basket.
contract AddStocks is Script {
    string[18] internal tickers = [
        "NVDA",
        "TSLA",
        "AAPL",
        "MSFT",
        "GOOGL",
        "AMZN",
        "QQQ",
        "SPY",
        "AMD",
        "AVGO",
        "TSM",
        "META",
        "JNJ",
        "PG",
        "KO",
        "PEP",
        "MCD",
        "IWM"
    ];
    string[18] internal names = [
        "NVIDIA (test)",
        "Tesla (test)",
        "Apple (test)",
        "Microsoft (test)",
        "Alphabet (test)",
        "Amazon (test)",
        "Nasdaq 100 ETF (test)",
        "S&P 500 ETF (test)",
        "Advanced Micro Devices (test)",
        "Broadcom (test)",
        "TSMC (test)",
        "Meta Platforms (test)",
        "Johnson & Johnson (test)",
        "Procter & Gamble (test)",
        "Coca-Cola (test)",
        "PepsiCo (test)",
        "McDonald's (test)",
        "Russell 2000 ETF (test)"
    ];

    function run() external {
        string memory existing = vm.readFile("deployments/testnet.json");
        TestExchange exchange = TestExchange(vm.parseJsonAddress(existing, ".exchange"));
        address usdt = vm.parseJsonAddress(existing, ".usdt");
        address keeper = vm.parseJsonAddress(existing, ".keeper");

        vm.startBroadcast();
        string memory stocks = "stocks";
        string memory out;
        for (uint256 i = 0; i < tickers.length; i++) {
            address stock = exchange.stockOf(tickers[i]);
            if (stock == address(0)) {
                stock = exchange.addStock(names[i], string.concat(tickers[i], "t"), tickers[i]);
                console.log("added", tickers[i], stock);
            }
            out = vm.serializeAddress(stocks, tickers[i], stock);
        }
        vm.stopBroadcast();

        string memory json = "deploy";
        vm.serializeAddress(json, "usdt", usdt);
        vm.serializeAddress(json, "exchange", address(exchange));
        vm.serializeAddress(json, "keeper", keeper);
        vm.writeJson(vm.serializeString(json, "stocks", out), "deployments/testnet.json");
    }
}
