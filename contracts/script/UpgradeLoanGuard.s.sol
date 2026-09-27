// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {LoanGuard} from "../src/LoanGuard.sol";

/// Upgrades the LoanGuard proxy recorded in deployments/venus-<NETWORK>.json to the current implementation.
/// Storage rule: only append fields to LoanGuardStorage. Run by the owner.
contract UpgradeLoanGuard is Script {
    function run() external {
        string memory path = string.concat("deployments/venus-", vm.envString("NETWORK"), ".json");
        LoanGuard proxy = LoanGuard(vm.parseJsonAddress(vm.readFile(path), ".loanGuard"));
        vm.startBroadcast();
        LoanGuard impl = new LoanGuard();
        proxy.upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();
        console.log("implementation:", address(impl));
    }
}
