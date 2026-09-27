// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IComptroller, LoanGuard} from "../src/LoanGuard.sol";

contract Token is ERC20 {
    constructor() ERC20("USDT", "USDT") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// One market that is both collateral and debt, priced at $1, liquidation threshold 80%.
contract MockVenus {
    Token public immutable underlying;
    mapping(address => uint256) public supplied; // underlying units
    mapping(address => uint256) public borrowed;
    uint256 public repayCode;

    constructor(Token t) {
        underlying = t;
    }

    function set(address a, uint256 s, uint256 b) external {
        supplied[a] = s;
        borrowed[a] = b;
    }

    function setRepayCode(uint256 c) external {
        repayCode = c;
    }

    // comptroller
    function getAssetsIn(address) external view returns (address[] memory r) {
        r = new address[](1);
        r[0] = address(this);
    }

    function oracle() external view returns (address) {
        return address(this);
    }

    function markets(address) external pure returns (bool, uint256, bool, uint256, uint256, uint256, bool) {
        return (true, 0.75e18, true, 0.8e18, 1.1e18, 0, true);
    }

    // oracle: $1 for an 18-decimal token
    function getUnderlyingPrice(address) external pure returns (uint256) {
        return 1e18;
    }

    // vToken: exchange rate 1e18 means 1 vToken = 1 underlying
    function getAccountSnapshot(address a) external view returns (uint256, uint256, uint256, uint256) {
        return (0, supplied[a], borrowed[a], 1e18);
    }

    function repayBorrowBehalf(address borrower, uint256 amount) external returns (uint256) {
        if (repayCode != 0) return repayCode;
        underlying.transferFrom(msg.sender, address(this), amount);
        borrowed[borrower] -= amount;
        return 0;
    }
}

contract LoanGuardTest is Test {
    LoanGuard guard;
    Token usdt;
    MockVenus venus;
    address admin = makeAddr("admin");
    address rio = makeAddr("rio");
    address agent = makeAddr("agent");

    function setUp() public {
        usdt = new Token();
        venus = new MockVenus(usdt);
        address impl = address(new LoanGuard());
        guard = LoanGuard(
            address(
                new ERC1967Proxy(
                    impl, abi.encodeCall(LoanGuard.initialize, (admin, IComptroller(address(venus))))
                )
            )
        );
        usdt.mint(rio, 1_000e18);
        vm.prank(rio);
        usdt.approve(address(guard), type(uint256).max);
        // $1,000 collateral × 80% = $800 limit; $720 debt = 90% used
        venus.set(rio, 1_000e18, 720e18);
        vm.prank(rio);
        guard.setGuard(agent, address(venus), 8_000, 6_000, 200e18, 1 hours);
    }

    function test_Position_UsesVenusPricesAndLiquidationThreshold() public view {
        (uint256 debt, uint256 limit) = guard.position(rio);
        assertEq(debt, 720e18);
        assertEq(limit, 800e18);
        assertEq(guard.usedBps(rio), 9_000);
    }

    function test_Rescue_RepaysFromBorrowerWhenAtRisk() public {
        vm.prank(agent);
        vm.expectEmit();
        emit LoanGuard.Rescued(rio, address(venus), 200e18, 9_000, 6_500);
        guard.rescue(rio, 200e18);
        assertEq(venus.borrowed(rio), 520e18);
        assertEq(usdt.balanceOf(rio), 800e18);
        assertEq(usdt.balanceOf(address(guard)), 0);
        assertEq(usdt.balanceOf(agent), 0);
        LoanGuard.Rescue[] memory h = guard.rescuesOf(rio);
        assertEq(h.length, 1);
        assertEq(h[0].amount, 200e18);
        assertEq(h[0].usedBpsBefore, 9_000);
        assertEq(h[0].usedBpsAfter, 6_500);
        assertEq(guard.borrowers().length, 1);
        vm.prank(rio);
        guard.setGuard(agent, address(venus), 8_500, 6_000, 200e18, 1 hours); // updating does not duplicate
        assertEq(guard.borrowers().length, 1);
    }

    function test_Rescue_Guards() public {
        vm.expectRevert(LoanGuard.NotExecutor.selector);
        guard.rescue(rio, 1e18);

        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(LoanGuard.OverCap.selector, uint128(200e18)));
        guard.rescue(rio, 201e18);
        guard.rescue(rio, 100e18); // 90% → 77.5%
        vm.expectRevert(
            abi.encodeWithSelector(LoanGuard.Cooldown.selector, uint40(block.timestamp + 1 hours))
        );
        guard.rescue(rio, 1e18);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(LoanGuard.NotAtRisk.selector, uint256(7_750), uint16(8_000)));
        guard.rescue(rio, 1e18);
        vm.stopPrank();
    }

    function test_Rescue_SurfacesVenusErrorCodesAndCancel() public {
        venus.setRepayCode(13);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LoanGuard.VenusError.selector, uint256(13)));
        guard.rescue(rio, 10e18);

        vm.prank(rio);
        guard.cancelGuard();
        vm.prank(agent);
        vm.expectRevert(LoanGuard.GuardInactive.selector);
        guard.rescue(rio, 10e18);
    }

    function test_SetGuard_RejectsBadThresholds() public {
        vm.startPrank(rio);
        vm.expectRevert(LoanGuard.BadThresholds.selector);
        guard.setGuard(agent, address(venus), 6_000, 6_000, 1e18, 0);
        vm.expectRevert(LoanGuard.BadThresholds.selector);
        guard.setGuard(agent, address(venus), 10_000, 6_000, 1e18, 0);
        vm.expectRevert(LoanGuard.ZeroAmount.selector);
        guard.setGuard(agent, address(venus), 8_000, 6_000, 0, 0);
        vm.stopPrank();
    }

    function test_Upgrade_OnlyOwner() public {
        address v2 = address(new LoanGuard());
        vm.prank(rio);
        vm.expectRevert();
        guard.upgradeToAndCall(v2, "");
        vm.prank(admin);
        guard.upgradeToAndCall(v2, "");
        assertEq(guard.guardOf(rio).executor, agent);
    }
}

interface IERC20Faucet {
    function allocateTo(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface IVTokenFull {
    function mint(uint256 amount) external returns (uint256);
    function borrow(uint256 amount) external returns (uint256);
    function borrowBalanceStored(address a) external view returns (uint256);
}

interface IComptrollerFull {
    function enterMarkets(address[] calldata vTokens) external returns (uint256[] memory);
}

/// Against the real Venus core pool on BSC testnet. `FORK_TESTS=true forge test --match-contract LoanGuardForkTest`.
contract LoanGuardForkTest is Test {
    address constant COMPTROLLER = 0x94d1820b2D1c7c7452A163983Dc888CEC546b77D;
    address constant VUSDT = 0xb7526572FFE56AB9D7489838Bf2E18e3323b441A;
    address constant USDT = 0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c; // 6 decimals, allocateTo faucet
    address constant VCAKE = 0xeDaC03D29ff74b5fDc0CC936F6288312e1459BC6;
    address constant CAKE = 0xe8bd7cCC165FAEb9b81569B05424771B9A20cbEF; // allocateTo faucet

    function test_Fork_RescueRealVenusPosition() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("bsc_testnet");
        address rio = makeAddr("rio");
        address agent = makeAddr("agent");
        LoanGuard guard = LoanGuard(
            address(
                new ERC1967Proxy(
                    address(new LoanGuard()),
                    abi.encodeCall(LoanGuard.initialize, (address(this), IComptroller(COMPTROLLER)))
                )
            )
        );

        vm.startPrank(rio);
        IERC20Faucet(CAKE).allocateTo(rio, 1_000e18);
        IERC20Faucet(USDT).allocateTo(rio, 500e6); // safety buffer
        IERC20Faucet(CAKE).approve(VCAKE, type(uint256).max);
        assertEq(IVTokenFull(VCAKE).mint(1_000e18), 0);
        address[] memory m = new address[](1);
        m[0] = VCAKE;
        IComptrollerFull(COMPTROLLER).enterMarkets(m);
        uint256 used0 = guard.usedBps(rio);
        assertEq(used0, 0);
        (, uint256 limit) = guard.position(rio);
        // borrow USDT worth 90% of the liquidation limit (USDT price scaled 1e30 for 6 decimals)
        uint256 usdtPrice = 0.5e30;
        (bool ok, bytes memory p) = address(0x3cD69251D04A28d887Ac14cbe2E14c52F3D57823)
            .staticcall(abi.encodeWithSignature("getUnderlyingPrice(address)", VUSDT));
        if (ok) usdtPrice = abi.decode(p, (uint256));
        uint256 borrowAmt = limit * 90 / 100 * 1e18 / usdtPrice;
        assertEq(IVTokenFull(VUSDT).borrow(borrowAmt), 0);
        uint256 usedBefore = guard.usedBps(rio);
        assertApproxEqAbs(usedBefore, 9_000, 5);

        IERC20Faucet(USDT).approve(address(guard), type(uint256).max);
        guard.setGuard(agent, VUSDT, 8_000, 6_000, uint128(borrowAmt), 1 hours);
        vm.stopPrank();

        uint256 repay = borrowAmt / 3;
        uint256 buffer = IERC20Faucet(USDT).balanceOf(rio);
        vm.prank(agent);
        guard.rescue(rio, repay);
        assertLt(guard.usedBps(rio), 8_000);
        assertEq(IERC20Faucet(USDT).balanceOf(rio), buffer - repay);
        assertApproxEqAbs(IVTokenFull(VUSDT).borrowBalanceStored(rio), borrowAmt - repay, 2);
    }
}
