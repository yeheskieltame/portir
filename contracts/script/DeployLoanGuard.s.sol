// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IComptroller, LoanGuard} from "../src/LoanGuard.sol";

/// Deploys the LoanGuard UUPS proxy against a Venus comptroller (COMPTROLLER env) and records it with the
/// Venus markets the app uses in deployments/venus-<NETWORK>.json. OWNER defaults to the deployer.
/// Deployed directly (implementation + ERC1967Proxy): the upgrades plugin trips over the two OpenZeppelin copies
/// in lib/. The implementation locks itself (_disableInitializers); upgrade auth is covered by LoanGuard.t.sol.
contract DeployLoanGuard is Script {
    function run() external returns (address proxy) {
        address comptroller = vm.envAddress("COMPTROLLER");
        address owner = vm.envOr("OWNER", msg.sender);
        string memory path = string.concat("deployments/venus-", vm.envString("NETWORK"), ".json");
        vm.startBroadcast();
        LoanGuard impl = new LoanGuard();
        proxy = address(
            new ERC1967Proxy(
                address(impl), abi.encodeCall(LoanGuard.initialize, (owner, IComptroller(comptroller)))
            )
        );
        vm.stopBroadcast();
        vm.writeJson(vm.toString(proxy), path, ".loanGuard");
        console.log("LoanGuard proxy:", proxy);
        console.log("implementation:", address(impl));
    }
}
