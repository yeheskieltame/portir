// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {
    Ownable2StepUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/// @notice DCA plans and their run history. Holds no funds.
contract PlanRegistry is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    enum Outcome {
        Executed,
        Waited,
        Skipped
    }

    struct Plan {
        address owner;
        address executor;
        bytes32 target;
        uint128 amount;
        uint32 interval;
        uint40 nextRunAt;
        bool smartTiming;
        bool active;
        bool once; // v3: buy one time when the Guard says GO, then complete
    }

    struct Run {
        uint40 at;
        Outcome outcome;
        int32 spreadBps;
        bytes32 txHash;
        string reason;
    }

    /// @custom:storage-location erc7201:portir.storage.PlanRegistry
    struct PlanRegistryStorage {
        Plan[] plans;
        mapping(uint256 planId => Run[]) runs;
        mapping(address owner => uint256[]) planIdsOf;
    }

    // keccak256(abi.encode(uint256(keccak256("portir.storage.PlanRegistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION =
        0xe38ffc6694c8b19fbd82fc7083d2c9fc71f79810e8f09c4dc7093ee343fe3000;

    uint32 public constant MIN_INTERVAL = 1 days;
    uint256 public constant MAX_REASON_LENGTH = 200;

    event PlanCreated(uint256 indexed planId, address indexed owner, bytes32 target, uint128 amount);
    event PlanUpdated(uint256 indexed planId, uint128 amount, uint32 interval, bool smartTiming);
    event PlanCancelled(uint256 indexed planId);
    event PlanResumed(uint256 indexed planId, uint40 nextRunAt);
    event PlanCompleted(uint256 indexed planId);
    event PlanRun(uint256 indexed planId, Outcome outcome, int32 spreadBps, bytes32 txHash, string reason);

    error ZeroAmount();
    error EmptyTarget();
    error IntervalTooShort();
    error NotPlanOwner();
    error NotAuthorized();
    error PlanInactive();
    error PlanActive();
    error NotDue(uint40 nextRunAt);
    error ReasonTooLong();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
    }

    function createPlan(
        bytes32 target,
        uint128 amount,
        uint32 interval,
        uint40 firstRunAt,
        bool smartTiming,
        bool once,
        address executor
    ) external returns (uint256 planId) {
        if (target == bytes32(0)) revert EmptyTarget();
        if (amount == 0) revert ZeroAmount();
        if (interval < MIN_INTERVAL) revert IntervalTooShort();

        PlanRegistryStorage storage $ = _storage();
        planId = $.plans.length;
        if (firstRunAt < block.timestamp) firstRunAt = uint40(block.timestamp);
        $.plans
            .push(Plan(msg.sender, executor, target, amount, interval, firstRunAt, smartTiming, true, once));
        $.planIdsOf[msg.sender].push(planId);
        emit PlanCreated(planId, msg.sender, target, amount);
    }

    /// @notice Change amount, cadence or smart timing; the next run date is kept.
    function updatePlan(uint256 planId, uint128 amount, uint32 interval, bool smartTiming) external {
        Plan storage plan = _storage().plans[planId];
        if (msg.sender != plan.owner) revert NotPlanOwner();
        if (!plan.active) revert PlanInactive();
        if (amount == 0) revert ZeroAmount();
        if (interval < MIN_INTERVAL) revert IntervalTooShort();
        plan.amount = amount;
        plan.interval = interval;
        plan.smartTiming = smartTiming;
        emit PlanUpdated(planId, amount, interval, smartTiming);
    }

    /// @notice Pause: the executor stops until `resumePlan`.
    function cancelPlan(uint256 planId) external {
        Plan storage plan = _storage().plans[planId];
        if (msg.sender != plan.owner) revert NotPlanOwner();
        if (!plan.active) revert PlanInactive();
        plan.active = false;
        emit PlanCancelled(planId);
    }

    /// @notice Resume a paused plan; a run date that passed while paused moves to now.
    function resumePlan(uint256 planId) external {
        Plan storage plan = _storage().plans[planId];
        if (msg.sender != plan.owner) revert NotPlanOwner();
        if (plan.active) revert PlanActive();
        plan.active = true;
        if (plan.nextRunAt < block.timestamp) plan.nextRunAt = uint40(block.timestamp);
        emit PlanResumed(planId, plan.nextRunAt);
    }

    function recordRun(
        uint256 planId,
        Outcome outcome,
        int32 spreadBps,
        bytes32 txHash,
        string calldata reason
    ) external {
        PlanRegistryStorage storage $ = _storage();
        Plan storage plan = $.plans[planId];
        if (msg.sender != plan.executor && msg.sender != plan.owner) {
            revert NotAuthorized();
        }
        if (!plan.active) revert PlanInactive();
        if (block.timestamp < plan.nextRunAt) revert NotDue(plan.nextRunAt);
        if (bytes(reason).length > MAX_REASON_LENGTH) revert ReasonTooLong();

        if (outcome != Outcome.Waited) {
            // Keep the original cadence unless whole periods were missed.
            uint256 next = uint256(plan.nextRunAt) + plan.interval;
            if (next <= block.timestamp) next = block.timestamp + plan.interval;
            // forge-lint: disable-next-line(unsafe-typecast)
            plan.nextRunAt = uint40(next);
        }

        $.runs[planId].push(Run(uint40(block.timestamp), outcome, spreadBps, txHash, reason));
        emit PlanRun(planId, outcome, spreadBps, txHash, reason);
        if (plan.once && outcome != Outcome.Waited) {
            plan.active = false;
            emit PlanCompleted(planId);
        }
    }

    function planCount() external view returns (uint256) {
        return _storage().plans.length;
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return _storage().plans[planId];
    }

    function planIdsOf(address owner) external view returns (uint256[] memory) {
        return _storage().planIdsOf[owner];
    }

    function runsOf(uint256 planId) external view returns (Run[] memory) {
        return _storage().runs[planId];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _storage() private pure returns (PlanRegistryStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
