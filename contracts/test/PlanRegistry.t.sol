// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";

/// @custom:oz-upgrades-from PlanRegistry
contract PlanRegistryV2 is PlanRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract PlanRegistryTest is Test {
    PlanRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal rio = makeAddr("rio");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant NVDA = "NVDA";
    uint128 internal constant AMOUNT = 50e18;
    uint32 internal constant WEEK = 7 days;

    function setUp() public {
        vm.warp(1_790_000_000);
        address impl = address(new PlanRegistry());
        registry =
            PlanRegistry(address(new ERC1967Proxy(impl, abi.encodeCall(PlanRegistry.initialize, (admin)))));
    }

    function _create(uint40 firstRunAt) internal returns (uint256) {
        vm.prank(rio);
        return registry.createPlan(NVDA, AMOUNT, WEEK, firstRunAt, true, agent);
    }

    function test_CreatePlan_StoresPlanAndIndexesByOwner() public {
        uint40 firstRunAt = uint40(block.timestamp + 1 days);

        vm.expectEmit();
        emit PlanRegistry.PlanCreated(0, rio, NVDA, AMOUNT);
        uint256 id = _create(firstRunAt);

        PlanRegistry.Plan memory plan = registry.getPlan(id);
        assertEq(plan.owner, rio);
        assertEq(plan.executor, agent);
        assertEq(plan.target, NVDA);
        assertEq(plan.amount, AMOUNT);
        assertEq(plan.nextRunAt, firstRunAt);
        assertTrue(plan.smartTiming);
        assertTrue(plan.active);

        uint256[] memory ids = registry.planIdsOf(rio);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
        assertEq(registry.planCount(), 1);
    }

    function test_CreatePlan_ClampsPastFirstRunToNow() public {
        uint256 id = _create(0);
        assertEq(registry.getPlan(id).nextRunAt, block.timestamp);
    }

    function test_CreatePlan_RevertsOnBadInput() public {
        vm.startPrank(rio);
        vm.expectRevert(PlanRegistry.EmptyTarget.selector);
        registry.createPlan(bytes32(0), AMOUNT, WEEK, 0, true, agent);
        vm.expectRevert(PlanRegistry.ZeroAmount.selector);
        registry.createPlan(NVDA, 0, WEEK, 0, true, agent);
        vm.expectRevert(PlanRegistry.IntervalTooShort.selector);
        registry.createPlan(NVDA, AMOUNT, 1 days - 1, 0, true, agent);
    }

    function test_RecordRun_ExecutedAdvancesSchedule() public {
        uint256 id = _create(0);
        uint40 due = registry.getPlan(id).nextRunAt;

        // PRD flow B: executes ~13h late, next run must stay on the original weekday.
        vm.warp(due + 13 hours);
        vm.prank(agent);
        registry.recordRun(
            id, PlanRegistry.Outcome.Executed, 20, keccak256("tx"), "Market open, spread 0.2%."
        );

        assertEq(registry.getPlan(id).nextRunAt, due + WEEK);

        PlanRegistry.Run[] memory runs = registry.runsOf(id);
        assertEq(runs.length, 1);
        assertEq(runs[0].at, due + 13 hours);
        assertEq(uint8(runs[0].outcome), uint8(PlanRegistry.Outcome.Executed));
        assertEq(runs[0].spreadBps, 20);
        assertEq(runs[0].reason, "Market open, spread 0.2%.");
    }

    function test_RecordRun_WaitedKeepsPlanDue() public {
        uint256 id = _create(0);
        uint40 due = registry.getPlan(id).nextRunAt;

        vm.startPrank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Waited, 130, 0, "Market closed, spread 1.3%.");
        assertEq(registry.getPlan(id).nextRunAt, due);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 20, keccak256("tx"), "");
        assertEq(registry.runsOf(id).length, 2);
    }

    function test_RecordRun_RevertsWhenNotDue() public {
        uint256 id = _create(0);
        vm.startPrank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "");

        uint40 next = registry.getPlan(id).nextRunAt;
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.NotDue.selector, next));
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "");
    }

    function test_RecordRun_RestartsFromNowAfterMissedPeriods() public {
        uint256 id = _create(0);
        vm.warp(block.timestamp + 3 * uint256(WEEK) + 1);
        vm.prank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Skipped, 0, 0, "");
        assertEq(registry.getPlan(id).nextRunAt, block.timestamp + WEEK);
    }

    function test_RecordRun_OwnerMayLogButStrangerMayNot() public {
        uint256 id = _create(0);

        vm.prank(stranger);
        vm.expectRevert(PlanRegistry.NotAuthorized.selector);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "");

        vm.prank(rio); // PRD fallback: user-confirmed execution in the UI
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "");
    }

    function test_RecordRun_RevertsOnLongReason() public {
        uint256 id = _create(0);
        string memory reason = string(new bytes(registry.MAX_REASON_LENGTH() + 1));
        vm.prank(agent);
        vm.expectRevert(PlanRegistry.ReasonTooLong.selector);
        registry.recordRun(id, PlanRegistry.Outcome.Waited, 0, 0, reason);
    }

    function test_CancelPlan_OnlyOwnerAndStopsRuns() public {
        uint256 id = _create(0);

        vm.prank(agent);
        vm.expectRevert(PlanRegistry.NotPlanOwner.selector);
        registry.cancelPlan(id);

        vm.prank(rio);
        registry.cancelPlan(id);
        assertFalse(registry.getPlan(id).active);

        vm.prank(agent);
        vm.expectRevert(PlanRegistry.PlanInactive.selector);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "");

        vm.prank(rio);
        vm.expectRevert(PlanRegistry.PlanInactive.selector);
        registry.cancelPlan(id);
    }

    function test_Initialize_OnlyOnceAndImplementationLocked() public {
        assertEq(registry.owner(), admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registry.initialize(stranger);

        PlanRegistry impl = new PlanRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(stranger);
    }

    function test_Upgrade_OnlyOwnerAndKeepsState() public {
        uint256 id = _create(0);
        address v2 = address(new PlanRegistryV2());

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger)
        );
        registry.upgradeToAndCall(v2, "");

        vm.prank(admin);
        registry.upgradeToAndCall(v2, "");

        assertEq(PlanRegistryV2(address(registry)).version(), 2);
        assertEq(registry.getPlan(id).owner, rio);
        assertEq(registry.planIdsOf(rio).length, 1);
    }

    /// Whatever the delay, a non-Waited run always lands nextRunAt strictly in the future
    /// and never more than one interval away, so a plan can neither double-run nor stall.
    function testFuzz_RecordRun_NextRunAlwaysInFuture(uint32 interval, uint32 delay, bool skipped) public {
        interval = uint32(bound(interval, registry.MIN_INTERVAL(), 365 days));
        vm.prank(rio);
        uint256 id = registry.createPlan(NVDA, AMOUNT, interval, 0, true, agent);

        vm.warp(block.timestamp + delay);
        vm.prank(agent);
        registry.recordRun(
            id, skipped ? PlanRegistry.Outcome.Skipped : PlanRegistry.Outcome.Executed, 0, 0, ""
        );

        uint40 next = registry.getPlan(id).nextRunAt;
        assertGt(next, block.timestamp);
        assertLe(next, block.timestamp + interval);
    }
}
