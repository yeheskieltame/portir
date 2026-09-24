// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";
import {TestExchange} from "../../src/testnet/TestExchange.sol";

/// Testnet exchange + one MockStock per featured and basket ticker. Reuses the tUSDT already in
/// deployments/testnet.json (deploy it once with DeployUSDT.s.sol); never redeploys a token that did not change.
/// KEEPER: the address whose signed quotes the exchange accepts (the app's and agent's TESTNET_KEEPER_KEY).
/// Add tickers later with AddStocks.s.sol.
contract DeployTestnet is Script {
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
        address keeper = vm.envAddress("KEEPER");
        MockUSDT usdt = MockUSDT(vm.parseJsonAddress(vm.readFile("deployments/testnet.json"), ".usdt"));
        vm.startBroadcast();
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
        console.log("tUSDT (reused):", address(usdt));
        console.log("TestExchange:", address(exchange));
    }
}
