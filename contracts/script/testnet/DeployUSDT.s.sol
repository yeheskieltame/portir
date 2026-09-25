// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";

/// Deploys tUSDT and records it in deployments/testnet.json. Refuses to replace a recorded one unless REPLACE=1
/// (replacing it also means a new TestExchange, whose tUSDT is immutable: run DeployTestnet.s.sol next).
contract DeployUSDT is Script {
    function run() external {
        string memory json = vm.readFile("deployments/testnet.json");
        if (vm.keyExistsJson(json, ".usdt") && !vm.envOr("REPLACE", false)) {
            revert("tUSDT already deployed; set REPLACE=1");
        }
        vm.startBroadcast();
        MockUSDT usdt = new MockUSDT();
        vm.stopBroadcast();
        vm.writeJson(vm.toString(address(usdt)), "deployments/testnet.json", ".usdt");
        console.log("tUSDT:", address(usdt));
    }
}
