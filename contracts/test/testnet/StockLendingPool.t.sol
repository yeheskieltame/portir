// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IComptroller, LoanGuard} from "../../src/LoanGuard.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";
import {PoolVToken, StockLendingPool} from "../../src/testnet/StockLendingPool.sol";

contract Stock is ERC20 {
    constructor() ERC20("NVIDIA (test)", "NVDAt") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

contract StockLendingPoolTest is Test {
    StockLendingPool pool;
    PoolVToken vNVDA;
    PoolVToken vUSDT;
    Stock nvda;
    MockUSDT usdt;
    LoanGuard guard;
    address keeper = makeAddr("keeper");
    address rio = makeAddr("rio");
    address agent = makeAddr("agent");
    address liquidator = makeAddr("liquidator");

    function setUp() public {
        nvda = new Stock();
        usdt = new MockUSDT();
        pool = new StockLendingPool(keeper);
        vNVDA = pool.listMarket(nvda, "vNVDAt", 0.6e18, 0.7e18, false);
        vUSDT = pool.listMarket(usdt, "vtUSDT", 0, 0.8e18, true);
        usdt.mint(address(vUSDT), 1_000_000e18); // lending liquidity
        _price(200e18);

        guard = LoanGuard(
            address(
                new ERC1967Proxy(
                    address(new LoanGuard()),
                    abi.encodeCall(LoanGuard.initialize, (address(this), IComptroller(address(pool))))
                )
            )
        );

        nvda.mint(rio, 10e18); // $2,000 of NVDA
        vm.startPrank(rio);
        nvda.approve(address(vNVDA), type(uint256).max);
        vNVDA.mint(10e18);
        address[] memory m = new address[](1);
        m[0] = address(vNVDA);
        pool.enterMarkets(m);
        vm.stopPrank();
    }

    function _price(uint128 p) internal {
        address[] memory v = new address[](1);
        uint128[] memory ps = new uint128[](1);
        v[0] = address(vNVDA);
        ps[0] = p;
        vm.prank(keeper);
        pool.setPrices(v, ps);
    }

    function test_Borrow_UpToCollateralFactor() public {
        vm.startPrank(rio);
        vm.expectRevert(StockLendingPool.InsufficientCollateral.selector);
        vUSDT.borrow(1_201e18); // limit $2,000 × 60% = $1,200
        assertEq(vUSDT.borrow(1_200e18), 0);
        assertEq(usdt.balanceOf(rio), 1_200e18);
        vm.expectRevert(StockLendingPool.InsufficientCollateral.selector);
        vNVDA.redeemUnderlying(1e18); // would leave the loan under-collateralised
        vm.stopPrank();
    }

    function test_StalePriceBlocksBorrow() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(rio);
        vm.expectRevert(abi.encodeWithSelector(StockLendingPool.StalePrice.selector, address(vNVDA)));
        vUSDT.borrow(1e18);
    }

    function test_LoanGuard_ReadsPoolLikeVenus_AndRescuesAfterPriceDrop() public {
        vm.prank(rio);
        vUSDT.borrow(1_000e18); // $1,000 debt, liquidation limit $2,000 × 70% = $1,400 → 71.4%
        assertEq(guard.usedBps(rio), 7_142);

        vm.startPrank(rio);
        usdt.approve(address(guard), 500e18);
        guard.setGuard(agent, address(vUSDT), 8_000, 6_000, 500e18, 1 hours);
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LoanGuard.NotAtRisk.selector, uint256(7_142), uint16(8_000)));
        guard.rescue(rio, 100e18);

        _price(170e18); // NVDA -15%: limit $1,190 → 84%
        assertEq(guard.usedBps(rio), 8_403);
        vm.prank(agent);
        guard.rescue(rio, 300e18);
        assertEq(vUSDT.borrowBalanceStored(rio), 700e18);
        assertEq(guard.usedBps(rio), 5_882);
    }

    function test_Liquidation_WhenPastThreshold() public {
        vm.prank(rio);
        vUSDT.borrow(1_200e18);
        usdt.mint(liquidator, 1_000e18);
        vm.startPrank(liquidator);
        usdt.approve(address(vUSDT), type(uint256).max);
        vm.expectRevert(StockLendingPool.NotLiquidatable.selector);
        pool.liquidate(rio, vUSDT, 100e18, vNVDA);
        vm.stopPrank();

        _price(160e18); // limit $1,600 × 70% = $1,120 < $1,200 debt
        vm.startPrank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(StockLendingPool.TooMuchRepay.selector, uint256(600e18)));
        pool.liquidate(rio, vUSDT, 601e18, vNVDA);
        pool.liquidate(rio, vUSDT, 400e18, vNVDA);
        vm.stopPrank();
        // $400 × 1.1 / $160 = 2.75 NVDA seized
        assertEq(vNVDA.balanceOf(liquidator), 2.75e18);
        assertEq(vNVDA.balanceOf(rio), 7.25e18);
        assertEq(vUSDT.borrowBalanceStored(rio), 800e18);
    }

    function test_RepayAll_AndOnlyKeeperPrices() public {
        vm.startPrank(rio);
        vUSDT.borrow(500e18);
        usdt.faucet();
        usdt.approve(address(vUSDT), type(uint256).max);
        vUSDT.repayBorrow(type(uint256).max);
        vm.stopPrank();
        assertEq(vUSDT.borrowBalanceStored(rio), 0);

        address[] memory v = new address[](1);
        uint128[] memory ps = new uint128[](1);
        v[0] = address(vNVDA);
        ps[0] = 1;
        vm.prank(rio);
        vm.expectRevert(StockLendingPool.NotKeeper.selector);
        pool.setPrices(v, ps);
        v[0] = address(vUSDT);
        vm.prank(keeper);
        vm.expectRevert(StockLendingPool.BadParams.selector); // the stablecoin stays at $1
        pool.setPrices(v, ps);
    }
}
