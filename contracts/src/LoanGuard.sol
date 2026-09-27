// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {
    Ownable2StepUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IComptroller {
    function getAssetsIn(address account) external view returns (address[] memory);
    function oracle() external view returns (address);
}

interface IVToken {
    function underlying() external view returns (address);
    function getAccountSnapshot(address account) external view returns (uint256, uint256, uint256, uint256);
    function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);
}

interface IVenusOracle {
    function getUnderlyingPrice(address vToken) external view returns (uint256);
}

/// @notice Keeps Venus borrowers out of liquidation. A borrower sets a guard and approves this contract for
/// the debt token (their safety buffer); the guard's executor may repay part of the debt on their behalf, but only
/// while the position is past the borrower's trigger, at most `maxPerRescue` per rescue and once per cooldown.
/// Funds go straight from the borrower to Venus; nothing is held here.
contract LoanGuard is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    struct Guard {
        address executor;
        address vToken; // the debt market repaid on rescue (e.g. vUSDT)
        uint16 triggerBps; // rescue allowed once debt / liquidation limit reaches this
        uint16 targetBps; // the executor aims back to this
        uint128 maxPerRescue; // in debt-token units
        uint32 cooldown;
        uint40 lastRescueAt;
        bool active;
    }

    struct Rescue {
        uint40 at;
        uint128 amount;
        uint16 usedBpsBefore;
        uint16 usedBpsAfter;
    }

    /// @custom:storage-location erc7201:portir.storage.LoanGuard
    struct LoanGuardStorage {
        IComptroller comptroller;
        mapping(address borrower => Guard) guards;
        address[] borrowers; // v2: everyone who ever set a guard (public RPCs block eth_getLogs)
        mapping(address borrower => Rescue[]) rescues; // v2
    }

    // keccak256(abi.encode(uint256(keccak256("portir.storage.LoanGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION =
        0xcb885a044aa5012d8aeddbe0b7158411fe701218245d1ce043c467401bd32a00;

    uint16 public constant MAX_BPS = 10_000;

    event GuardSet(
        address indexed borrower, address executor, address vToken, uint16 triggerBps, uint16 targetBps
    );
    event GuardCancelled(address indexed borrower);
    event Rescued(
        address indexed borrower,
        address indexed vToken,
        uint256 amount,
        uint256 usedBpsBefore,
        uint256 usedBpsAfter
    );

    error BadThresholds();
    error ZeroAmount();
    error NotExecutor();
    error GuardInactive();
    error OverCap(uint128 cap);
    error Cooldown(uint40 until);
    error NotAtRisk(uint256 usedBps, uint16 triggerBps);
    error VenusError(uint256 code);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, IComptroller comptroller_) external initializer {
        __Ownable_init(initialOwner);
        _storage().comptroller = comptroller_;
    }

    function setGuard(
        address executor,
        address vToken,
        uint16 triggerBps,
        uint16 targetBps,
        uint128 maxPerRescue,
        uint32 cooldown
    ) external {
        if (targetBps == 0 || targetBps >= triggerBps || triggerBps >= MAX_BPS) {
            revert BadThresholds();
        }
        if (maxPerRescue == 0) revert ZeroAmount();
        LoanGuardStorage storage $ = _storage();
        Guard storage g = $.guards[msg.sender];
        if (g.vToken == address(0)) $.borrowers.push(msg.sender);
        g.executor = executor;
        g.vToken = vToken;
        g.triggerBps = triggerBps;
        g.targetBps = targetBps;
        g.maxPerRescue = maxPerRescue;
        g.cooldown = cooldown;
        g.active = true;
        emit GuardSet(msg.sender, executor, vToken, triggerBps, targetBps);
    }

    function cancelGuard() external {
        Guard storage g = _storage().guards[msg.sender];
        if (!g.active) revert GuardInactive();
        g.active = false;
        emit GuardCancelled(msg.sender);
    }

    /// @notice Repay `amount` of the borrower's debt from their own wallet. The position must be past the trigger.
    function rescue(address borrower, uint256 amount) external {
        Guard storage g = _storage().guards[borrower];
        if (!g.active) revert GuardInactive();
        if (msg.sender != g.executor) revert NotExecutor();
        if (amount == 0) revert ZeroAmount();
        if (amount > g.maxPerRescue) revert OverCap(g.maxPerRescue);
        uint40 until = g.lastRescueAt + g.cooldown;
        if (g.lastRescueAt != 0 && block.timestamp < until) revert Cooldown(until);
        uint256 before = usedBps(borrower);
        if (before < g.triggerBps) revert NotAtRisk(before, g.triggerBps);

        g.lastRescueAt = uint40(block.timestamp);
        IERC20 token = IERC20(IVToken(g.vToken).underlying());
        token.safeTransferFrom(borrower, address(this), amount);
        token.forceApprove(g.vToken, amount);
        // Venus vTokens report most failures as a non-zero code instead of reverting.
        uint256 code = IVToken(g.vToken).repayBorrowBehalf(borrower, amount);
        if (code != 0) revert VenusError(code);
        uint256 afterBps = usedBps(borrower);
        _storage()
        .rescues[borrower].push(
            // amount <= maxPerRescue (uint128), checked above
            // forge-lint: disable-next-line(unsafe-typecast)
            Rescue(uint40(block.timestamp), uint128(amount), _bps16(before), _bps16(afterBps))
        );
        emit Rescued(borrower, g.vToken, amount, before, afterBps);
    }

    function borrowers() external view returns (address[] memory) {
        return _storage().borrowers;
    }

    function rescuesOf(address borrower) external view returns (Rescue[] memory) {
        return _storage().rescues[borrower];
    }

    /// @notice Debt as a share of the liquidation limit, in bps (10_000 = liquidatable), from Venus' own oracle
    /// and liquidation thresholds across every market the borrower entered.
    function usedBps(address borrower) public view returns (uint256) {
        (uint256 debt, uint256 limit) = position(borrower);
        if (debt == 0) return 0;
        if (limit == 0) return type(uint256).max;
        return debt * MAX_BPS / limit;
    }

    /// @notice Total borrows and the liquidation limit (Σ collateral × liquidation threshold), in USD with 18 decimals.
    function position(address borrower) public view returns (uint256 debtUsd, uint256 limitUsd) {
        IComptroller c = _storage().comptroller;
        IVenusOracle oracle = IVenusOracle(c.oracle());
        address[] memory assets = c.getAssetsIn(borrower);
        for (uint256 i = 0; i < assets.length; i++) {
            (uint256 err, uint256 vBal, uint256 borrowBal, uint256 rate) =
                IVToken(assets[i]).getAccountSnapshot(borrower);
            if (err != 0) revert VenusError(err);
            uint256 price = oracle.getUnderlyingPrice(assets[i]); // scaled 1e(36 - decimals)
            debtUsd += borrowBal * price / 1e18;
            if (vBal != 0) {
                limitUsd += vBal * rate / 1e18 * price / 1e18 * _liquidationThreshold(c, assets[i]) / 1e18;
            }
        }
    }

    function guardOf(address borrower) external view returns (Guard memory) {
        return _storage().guards[borrower];
    }

    function comptroller() external view returns (IComptroller) {
        return _storage().comptroller;
    }

    /// @dev `markets()` grew fields across Comptroller versions; the fourth word is the liquidation threshold.
    function _liquidationThreshold(IComptroller c, address vToken) private view returns (uint256 lt) {
        (bool ok, bytes memory data) =
            address(c).staticcall(abi.encodeWithSignature("markets(address)", vToken));
        if (!ok || data.length < 128) return 0;
        (,,, lt) = abi.decode(data, (bool, uint256, bool, uint256));
    }

    function _bps16(uint256 bps) private pure returns (uint16) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return bps > type(uint16).max ? type(uint16).max : uint16(bps);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _storage() private pure returns (LoanGuardStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
