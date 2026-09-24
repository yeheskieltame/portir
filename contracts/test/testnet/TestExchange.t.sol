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
    uint256 keeperPk = 0xA11CE;
    address keeper = vm.addr(keeperPk);
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

    function _quote(address stock, uint128 price, uint40 deadline, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ex.quoteDigest(stock, price, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _quote(uint128 price) internal view returns (bytes memory) {
        return _quote(nvda, price, uint40(block.timestamp + 10 minutes), keeperPk);
    }

    // Sign first: a prank or expectRevert must land on `buy`, not on the `quoteDigest` view.
    function _buy(uint128 price, uint256 usdtIn, uint256 minShares) internal returns (uint256) {
        bytes memory sig = _quote(price);
        return ex.buy(nvda, usdtIn, minShares, price, uint40(block.timestamp + 10 minutes), sig);
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

    function test_Buy_MintsSharesAtQuotedPriceMinusFee() public {
        vm.startPrank(alice);
        uint256 shares = _buy(200e18, 100e18, 0);
        vm.stopPrank();
        // 100 USDT - 0.1% = 99.9 USDT / 200 = 0.4995 shares
        assertEq(shares, 0.4995e18);
        assertEq(MockStock(nvda).balanceOf(alice), 0.4995e18);
        assertEq(usdt.balanceOf(address(ex)), 100e18);
    }

    function test_Buy_RevertsOnSlippageExpiredForgedAndUnknown() public {
        uint40 deadline = uint40(block.timestamp + 10 minutes);
        bytes memory sig = _quote(200e18);
        bytes memory forged = _quote(nvda, 200e18, deadline, 0xBAD);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestExchange.Slippage.selector, 0.4995e18, 0.5e18));
        ex.buy(nvda, 100e18, 0.5e18, 200e18, deadline, sig);

        vm.expectRevert(TestExchange.BadQuote.selector);
        ex.buy(nvda, 100e18, 0, 100e18, deadline, sig); // price differs from what was signed

        vm.expectRevert(TestExchange.BadQuote.selector);
        ex.buy(nvda, 100e18, 0, 200e18, deadline, forged);

        vm.expectRevert(TestExchange.UnknownStock.selector);
        ex.buy(address(usdt), 100e18, 0, 200e18, deadline, sig);

        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(TestExchange.QuoteExpired.selector, deadline));
        ex.buy(nvda, 100e18, 0, 200e18, deadline, sig);
        vm.stopPrank();
    }

    function test_BuyBatch_OneTxManyStocks_AllOrNothing() public {
        address tsla = ex.addStock("Tesla (test)", "TSLAt", "TSLA");
        uint40 deadline = uint40(block.timestamp + 10 minutes);
        address[] memory stocks = new address[](2);
        stocks[0] = nvda;
        stocks[1] = tsla;
        uint256[] memory usdtIn = new uint256[](2);
        usdtIn[0] = 100e18;
        usdtIn[1] = 50e18;
        uint256[] memory minOut = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        prices[0] = 200e18;
        prices[1] = 400e18;
        uint40[] memory deadlines = new uint40[](2);
        deadlines[0] = deadline;
        deadlines[1] = deadline;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _quote(nvda, 200e18, deadline, keeperPk);
        sigs[1] = _quote(tsla, 400e18, deadline, keeperPk);

        vm.prank(alice);
        uint256[] memory out = ex.buyBatch(stocks, usdtIn, minOut, prices, deadlines, sigs);
        assertEq(out[0], 0.4995e18);
        assertEq(out[1], 0.124875e18);
        assertEq(MockStock(tsla).balanceOf(alice), 0.124875e18);
        assertEq(usdt.balanceOf(address(ex)), 150e18);

        // one bad leg reverts the whole basket
        sigs[1] = _quote(tsla, 400e18, deadline, 0xBAD);
        vm.prank(alice);
        vm.expectRevert(TestExchange.BadQuote.selector);
        ex.buyBatch(stocks, usdtIn, minOut, prices, deadlines, sigs);
        assertEq(usdt.balanceOf(address(ex)), 150e18);

        uint256[] memory short = new uint256[](1);
        vm.prank(alice);
        vm.expectRevert(TestExchange.LengthMismatch.selector);
        ex.buyBatch(stocks, short, minOut, prices, deadlines, sigs);
    }

    function test_Sell_BurnsAndPaysFromLiquidity() public {
        bytes memory sig = _quote(200e18);
        vm.startPrank(alice);
        _buy(200e18, 100e18, 0);
        uint256 out = ex.sell(nvda, 0.4995e18, 0, 200e18, uint40(block.timestamp + 10 minutes), sig);
        vm.stopPrank();
        // 0.4995 * 200 = 99.9, minus 0.1% = 99.8001
        assertEq(out, 99.8001e18);
        assertEq(MockStock(nvda).balanceOf(alice), 0);
    }

    function test_OnlyOwnerAddsStocksAndSetsKeeper() public {
        vm.prank(alice);
        vm.expectRevert();
        ex.addStock("x", "x", "X");
        vm.expectRevert(TestExchange.DuplicateTicker.selector);
        ex.addStock("NVIDIA again", "NVDAt2", "NVDA");
        vm.prank(alice);
        vm.expectRevert();
        ex.setKeeper(alice);
        ex.setKeeper(alice);
        assertEq(ex.keeper(), alice);
    }

    function test_OnlyExchangeMints() public {
        vm.prank(alice);
        vm.expectRevert(MockStock.NotExchange.selector);
        MockStock(nvda).mint(alice, 1);
    }

    function testFuzz_BuyThenSellNeverPaysOutMoreThanPaidIn(uint96 usdtIn, uint96 price) public {
        usdtIn = uint96(bound(usdtIn, 1e12, 1_000e18));
        price = uint96(bound(price, 1e15, 100_000e18));
        bytes memory sig = _quote(price);
        vm.startPrank(alice);
        uint256 shares = _buy(price, usdtIn, 0);
        uint256 out =
            shares == 0 ? 0 : ex.sell(nvda, shares, 0, price, uint40(block.timestamp + 10 minutes), sig);
        vm.stopPrank();
        assertLe(out, usdtIn);
    }
}
