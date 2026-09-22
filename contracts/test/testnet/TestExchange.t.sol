// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockStock} from "../../src/testnet/MockStock.sol";
import {MockUSDT} from "../../src/testnet/MockUSDT.sol";
import {TestExchange} from "../../src/testnet/TestExchange.sol";

contract TestExchangeTest is Test {
    MockUSDT usdt;
    TestExchange ex;
    address nvda;
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");

    function setUp() public {
        usdt = new MockUSDT();
        ex = new TestExchange(usdt, keeper, 10); // 0.10% fee
        nvda = ex.addStock("NVIDIA (test)", "NVDAt", "NVDA");
        vm.prank(alice);
        usdt.faucet();
        vm.prank(alice);
        usdt.approve(address(ex), type(uint256).max);
    }

    function _price(uint128 p) internal {
        address[] memory s = new address[](1);
        uint128[] memory ps = new uint128[](1);
        s[0] = nvda;
        ps[0] = p;
        vm.prank(keeper);
        ex.setPrices(s, ps);
    }

    function test_Faucet_OncePerDay() public {
        assertEq(usdt.balanceOf(alice), 1_000e18);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MockUSDT.FaucetCooldown.selector, uint40(block.timestamp + 1 days))
        );
        usdt.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        usdt.faucet();
        assertEq(usdt.balanceOf(alice), 2_000e18);
    }

    function test_Buy_MintsSharesAtPriceMinusFee() public {
        _price(200e18);
        vm.prank(alice);
        uint256 shares = ex.buy(nvda, 100e18, 0);
        // 100 USDT - 0.1% = 99.9 USDT / 200 = 0.4995 shares
        assertEq(shares, 0.4995e18);
        assertEq(MockStock(nvda).balanceOf(alice), 0.4995e18);
        assertEq(usdt.balanceOf(address(ex)), 100e18);
    }

    function test_Buy_RevertsOnSlippageStaleAndUnknown() public {
        _price(200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestExchange.Slippage.selector, 0.4995e18, 0.5e18));
        ex.buy(nvda, 100e18, 0.5e18);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(TestExchange.StalePrice.selector, uint40(block.timestamp - 2 hours))
        );
        ex.buy(nvda, 100e18, 0);

        vm.prank(alice);
        vm.expectRevert(TestExchange.UnknownStock.selector);
        ex.buy(address(usdt), 100e18, 0);
    }

    function test_Sell_BurnsAndPaysFromLiquidity() public {
        _price(200e18);
        vm.startPrank(alice);
        ex.buy(nvda, 100e18, 0);
        uint256 out = ex.sell(nvda, 0.4995e18, 0);
        vm.stopPrank();
        // 0.4995 * 200 = 99.9, minus 0.1% = 99.8001
        assertEq(out, 99.8001e18);
        assertEq(MockStock(nvda).balanceOf(alice), 0);
    }

    function test_OnlyKeeperOrOwnerSetsPrices_OnlyOwnerAddsStocks() public {
        address[] memory s = new address[](1);
        uint128[] memory ps = new uint128[](1);
        s[0] = nvda;
        ps[0] = 1e18;
        vm.prank(alice);
        vm.expectRevert(TestExchange.NotKeeper.selector);
        ex.setPrices(s, ps);
        ex.setPrices(s, ps); // owner may
        vm.prank(alice);
        vm.expectRevert();
        ex.addStock("x", "x", "X");
        vm.expectRevert(TestExchange.DuplicateTicker.selector);
        ex.addStock("NVIDIA again", "NVDAt2", "NVDA");
    }

    function test_OnlyExchangeMints() public {
        vm.prank(alice);
        vm.expectRevert(MockStock.NotExchange.selector);
        MockStock(nvda).mint(alice, 1);
    }

    function testFuzz_BuyThenSellNeverPaysOutMoreThanPaidIn(uint96 usdtIn, uint96 price) public {
        usdtIn = uint96(bound(usdtIn, 1e12, 1_000e18));
        price = uint96(bound(price, 1e15, 100_000e18));
        _price(price);
        vm.startPrank(alice);
        uint256 shares = ex.buy(nvda, usdtIn, 0);
        uint256 out = shares == 0 ? 0 : ex.sell(nvda, shares, 0);
        vm.stopPrank();
        assertLe(out, usdtIn);
    }
}
