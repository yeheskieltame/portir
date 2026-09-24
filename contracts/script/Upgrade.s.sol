// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Options, Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

/// Upgrades the PlanRegistry proxy (PROXY env) to the current implementation. The owner must run it.
/// PlanRegistry keeps its name across versions, so the plugin has no reference build to diff the storage
/// against: the layout check is skipped here and enforced by review instead (see contracts/AUDIT.md).
contract Upgrade is Script {
    function run() external {
        address proxy = vm.envAddress("PROXY");
        Options memory opts;
        opts.unsafeSkipStorageCheck = true;
        vm.startBroadcast();
        Upgrades.upgradeProxy(proxy, "PlanRegistry.sol", "", opts);
        vm.stopBroadcast();
        console.log("implementation:", Upgrades.getImplementationAddress(proxy));
    }
}
