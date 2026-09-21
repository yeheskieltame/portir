// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";

/// forge clean && forge script script/Deploy.s.sol --rpc-url bsc --account deployer --sender <addr> --broadcast --verify
contract Deploy is Script {
    function run() external returns (address proxy) {
        address owner = vm.envOr("OWNER", msg.sender);
        vm.startBroadcast();
        proxy = Upgrades.deployUUPSProxy("PlanRegistry.sol", abi.encodeCall(PlanRegistry.initialize, (owner)));
        vm.stopBroadcast();
        console.log("PlanRegistry proxy:", proxy);
        console.log("implementation:", Upgrades.getImplementationAddress(proxy));
    }
}
