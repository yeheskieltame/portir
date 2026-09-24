// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PlanRegistry} from "../src/PlanRegistry.sol";
import {MockUSDT} from "../src/testnet/MockUSDT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        return registry.createPlan(NVDA, AMOUNT, WEEK, firstRunAt, true, false, agent);
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
        registry.createPlan(bytes32(0), AMOUNT, WEEK, 0, true, false, agent);
        vm.expectRevert(PlanRegistry.ZeroAmount.selector);
        registry.createPlan(NVDA, 0, WEEK, 0, true, false, agent);
        vm.expectRevert(PlanRegistry.IntervalTooShort.selector);
        registry.createPlan(NVDA, AMOUNT, 1 days - 1, 0, true, false, agent);
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

    function test_UpdatePlan_OwnerChangesTermsKeepsSchedule() public {
        uint40 firstRunAt = uint40(block.timestamp + 1 days);
        uint256 id = _create(firstRunAt);

        vm.prank(agent);
        vm.expectRevert(PlanRegistry.NotPlanOwner.selector);
        registry.updatePlan(id, 20e18, 14 days, false);

        vm.startPrank(rio);
        vm.expectRevert(PlanRegistry.ZeroAmount.selector);
        registry.updatePlan(id, 0, 14 days, false);
        vm.expectRevert(PlanRegistry.IntervalTooShort.selector);
        registry.updatePlan(id, 20e18, 1 hours, false);

        vm.expectEmit();
        emit PlanRegistry.PlanUpdated(id, 20e18, 14 days, false);
        registry.updatePlan(id, 20e18, 14 days, false);
        vm.stopPrank();

        PlanRegistry.Plan memory plan = registry.getPlan(id);
        assertEq(plan.amount, 20e18);
        assertEq(plan.interval, 14 days);
        assertFalse(plan.smartTiming);
        assertEq(plan.nextRunAt, firstRunAt);
    }

    function test_ResumePlan_ReactivatesAndMovesPastRunToNow() public {
        uint256 id = _create(0);
        vm.prank(rio);
        registry.cancelPlan(id);

        vm.prank(rio);
        vm.expectRevert(PlanRegistry.PlanInactive.selector);
        registry.updatePlan(id, 20e18, WEEK, true);

        vm.warp(block.timestamp + 3 days);
        vm.prank(stranger);
        vm.expectRevert(PlanRegistry.NotPlanOwner.selector);
        registry.resumePlan(id);

        vm.prank(rio);
        registry.resumePlan(id);
        PlanRegistry.Plan memory plan = registry.getPlan(id);
        assertTrue(plan.active);
        assertEq(plan.nextRunAt, block.timestamp);

        vm.prank(rio);
        vm.expectRevert(PlanRegistry.PlanActive.selector);
        registry.resumePlan(id);
    }

    function test_OncePlan_CompletesAfterOneExecutedRun() public {
        vm.prank(rio);
        uint256 id = registry.createPlan(NVDA, AMOUNT, WEEK, 0, true, true, agent);
        assertTrue(registry.getPlan(id).once);

        vm.prank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Waited, 120, 0, "market closed");
        assertTrue(registry.getPlan(id).active);

        vm.prank(agent);
        vm.expectEmit();
        emit PlanRegistry.PlanCompleted(id);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 5, bytes32(uint256(1)), "bought");
        assertFalse(registry.getPlan(id).active);

        vm.prank(agent);
        vm.expectRevert(PlanRegistry.PlanInactive.selector);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 5, bytes32(uint256(2)), "again");
    }

    function test_ResumePlan_PausedOncePlanResumes_CompletedOnceDoesNot() public {
        vm.prank(rio);
        uint256 id = registry.createPlan(NVDA, AMOUNT, WEEK, 0, true, true, agent);

        // paused before any buy: resumable
        vm.prank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Waited, 120, 0, "closed");
        vm.prank(rio);
        registry.cancelPlan(id);
        vm.prank(rio);
        registry.resumePlan(id);
        assertTrue(registry.getPlan(id).active);

        // bought once: finished for good
        vm.prank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 5, bytes32(uint256(1)), "bought");
        assertFalse(registry.getPlan(id).active);
        vm.prank(rio);
        vm.expectRevert(PlanRegistry.PlanDone.selector);
        registry.resumePlan(id);

        // gave up (Skipped) also finishes a once plan
        vm.prank(rio);
        uint256 id2 = registry.createPlan(NVDA, AMOUNT, WEEK, 0, true, true, agent);
        vm.prank(agent);
        registry.recordRun(id2, PlanRegistry.Outcome.Skipped, 0, 0, "no fair moment");
        vm.prank(rio);
        vm.expectRevert(PlanRegistry.PlanDone.selector);
        registry.resumePlan(id2);
    }

    function _funded() internal returns (MockUSDT usdt, uint256 id) {
        usdt = new MockUSDT();
        vm.prank(admin);
        registry.setFundingToken(IERC20(address(usdt)));
        vm.startPrank(rio);
        usdt.faucet();
        usdt.approve(address(registry), type(uint256).max);
        vm.stopPrank();
        vm.prank(agent);
        usdt.approve(address(registry), type(uint256).max);
        id = _create(0);
    }

    function test_PullFunds_CappedPerScheduledRun() public {
        (MockUSDT usdt, uint256 id) = _funded();

        vm.prank(agent);
        registry.pullFunds(id, 30e18);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.OverBudget.selector, uint128(20e18)));
        registry.pullFunds(id, 21e18);
        vm.prank(agent);
        registry.pullFunds(id, 20e18);
        assertEq(usdt.balanceOf(agent), AMOUNT);
        assertEq(registry.pulledFor(id), AMOUNT);

        // unspent money goes back and frees the budget for a retry in the same run
        vm.prank(agent);
        registry.returnFunds(id, 10e18);
        assertEq(usdt.balanceOf(rio), 1_000e18 - 40e18);
        assertEq(registry.pulledFor(id), 40e18);

        vm.prank(agent);
        registry.recordRun(id, PlanRegistry.Outcome.Executed, 0, 0, "bought");
        assertEq(registry.pulledFor(id), 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PlanRegistry.NotDue.selector, uint40(block.timestamp + WEEK)));
        registry.pullFunds(id, 1e18);

        vm.warp(block.timestamp + WEEK);
        vm.prank(agent);
        registry.pullFunds(id, AMOUNT); // a new run has a fresh budget
    }

    function test_PullFunds_OnlyExecutorWhileActiveWithToken() public {
        uint256 bare = _create(0);
        vm.prank(agent);
        vm.expectRevert(PlanRegistry.NoFundingToken.selector);
        registry.pullFunds(bare, 1e18);

        (, uint256 id) = _funded();
        vm.prank(rio);
        vm.expectRevert(PlanRegistry.NotAuthorized.selector);
        registry.pullFunds(id, 1e18);
        vm.prank(stranger);
        vm.expectRevert();
        registry.setFundingToken(IERC20(address(0)));

        vm.prank(rio);
        registry.cancelPlan(id);
        vm.prank(agent);
        vm.expectRevert(PlanRegistry.PlanInactive.selector);
        registry.pullFunds(id, 1e18);
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
        uint256 id = registry.createPlan(NVDA, AMOUNT, interval, 0, true, false, agent);

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
