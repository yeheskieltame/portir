// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";

/// Deploys tUSDT once and records it in deployments/testnet.json. Refuses to run if one is already recorded.
contract DeployUSDT is Script {
    function run() external {
        string memory json = vm.readFile("deployments/testnet.json");
        if (vm.keyExistsJson(json, ".usdt")) revert("tUSDT already deployed; nothing to do");
        vm.startBroadcast();
        MockUSDT usdt = new MockUSDT();
        vm.stopBroadcast();
        vm.writeJson(vm.toString(address(usdt)), "deployments/testnet.json", ".usdt");
        console.log("tUSDT:", address(usdt));
    }
}
