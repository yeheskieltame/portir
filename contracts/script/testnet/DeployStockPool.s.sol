// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IComptroller, LoanGuard} from "../../src/LoanGuard.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";
import {PoolVToken, StockLendingPool} from "../../src/testnet/StockLendingPool.sol";

/// Venus-compatible stock lending pool on testnet over the existing tUSDT and MockStocks (read from
/// deployments/testnet.json; nothing there is redeployed), plus a LoanGuard proxy pointed at it.
/// KEEPER: who mirrors live stock prices (the agent wallet). Writes deployments/stockpool-testnet.json.
contract DeployStockPool is Script {
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

    function run() external {
        string memory fx = vm.readFile("deployments/testnet.json");
        MockUSDT usdt = MockUSDT(vm.parseJsonAddress(fx, ".usdt"));
        address keeper = vm.envAddress("KEEPER");
        vm.startBroadcast();
        StockLendingPool pool = new StockLendingPool(keeper);
        PoolVToken vUSDT = pool.listMarket(IERC20(address(usdt)), "vtUSDT", 0, 0.8e18, true);
        usdt.mint(address(vUSDT), 1_000_000e18);
        string memory m = "markets";
        string memory out;
        for (uint256 i = 0; i < tickers.length; i++) {
            address stock = vm.parseJsonAddress(fx, string.concat(".stocks.", tickers[i]));
            PoolVToken v =
                pool.listMarket(IERC20(stock), string.concat("v", tickers[i], "t"), 0.6e18, 0.7e18, false);
            out = vm.serializeAddress(m, tickers[i], address(v));
        }
        LoanGuard impl = new LoanGuard();
        address guard = address(
            new ERC1967Proxy(
                address(impl), abi.encodeCall(LoanGuard.initialize, (msg.sender, IComptroller(address(pool))))
            )
        );
        vm.stopBroadcast();

        string memory j = "pool";
        vm.serializeAddress(j, "pool", address(pool));
        vm.serializeAddress(j, "vUSDT", address(vUSDT));
        vm.serializeAddress(j, "USDT", address(usdt));
        vm.serializeAddress(j, "loanGuard", guard);
        vm.serializeAddress(j, "loanGuardImpl", address(impl));
        vm.writeJson(vm.serializeString(j, "markets", out), "deployments/stockpool-testnet.json");
        console.log("pool", address(pool));
        console.log("loanGuard", guard);
    }
}
