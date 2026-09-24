// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Testnet issuer + DEX in one: sells and buys back MockStock shares at a signed quote.
/// The keeper signs (stock, price, deadline) off-chain with the live mainnet price at quote time,
/// so a testnet trade settles at the same price the Guard judged, with no on-chain price feed to go stale.
contract TestExchange is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 private constant QUOTE_TYPEHASH = keccak256("Quote(address stock,uint128 price,uint40 deadline)");
    uint16 public constant MAX_FEE_BPS = 200;

    IERC20 public immutable usdt;
    address public keeper;
    uint16 public feeBps;

    address[] public stocks;
    mapping(address stock => bool) public isStock;
    mapping(string ticker => address) public stockOf;

    event StockAdded(address indexed stock, string ticker);
    event Bought(
        address indexed buyer, address indexed stock, uint256 usdtIn, uint256 sharesOut, uint128 price
    );
    event Sold(
        address indexed seller, address indexed stock, uint256 sharesIn, uint256 usdtOut, uint128 price
    );

    error UnknownStock();
    error DuplicateTicker();
    error QuoteExpired(uint40 deadline);
    error BadQuote();
    error ZeroAmount();
    error Slippage(uint256 out, uint256 min);
    error FeeTooHigh();
    error LengthMismatch();
    error InsufficientLiquidity();

    constructor(IERC20 usdt_, address keeper_, uint16 feeBps_)
        Ownable(msg.sender)
        EIP712("Portir TestExchange", "1")
    {
        usdt = usdt_;
        keeper = keeper_;
        _setFee(feeBps_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
    }

    function setFee(uint16 feeBps_) external onlyOwner {
        _setFee(feeBps_);
    }

    function addStock(string calldata name, string calldata symbol, string calldata ticker)
        external
        onlyOwner
        returns (address stock)
    {
        if (stockOf[ticker] != address(0)) revert DuplicateTicker();
        stock = address(new MockStock(name, symbol, ticker, address(this)));
        stocks.push(stock);
        isStock[stock] = true;
        stockOf[ticker] = stock;
        emit StockAdded(stock, ticker);
    }

    /// @notice Pay `usdtIn`, receive shares at the quoted price minus the fee.
    function buy(
        address stock,
        uint256 usdtIn,
        uint256 minSharesOut,
        uint128 price,
        uint40 deadline,
        bytes calldata sig
    ) external returns (uint256 sharesOut) {
        return _buy(stock, usdtIn, minSharesOut, price, deadline, sig);
    }

    /// @notice A basket in one transaction: one quoted buy per holding, all or nothing.
    function buyBatch(
        address[] calldata stocks_,
        uint256[] calldata usdtIn,
        uint256[] calldata minSharesOut,
        uint128[] calldata prices,
        uint40[] calldata deadlines,
        bytes[] calldata sigs
    ) external returns (uint256[] memory sharesOut) {
        uint256 n = stocks_.length;
        if (
            usdtIn.length != n || minSharesOut.length != n || prices.length != n || deadlines.length != n
                || sigs.length != n
        ) revert LengthMismatch();
        sharesOut = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            sharesOut[i] = _buy(stocks_[i], usdtIn[i], minSharesOut[i], prices[i], deadlines[i], sigs[i]);
        }
    }

    function _buy(
        address stock,
        uint256 usdtIn,
        uint256 minSharesOut,
        uint128 price,
        uint40 deadline,
        bytes calldata sig
    ) private returns (uint256 sharesOut) {
        if (usdtIn == 0) revert ZeroAmount();
        _verify(stock, price, deadline, sig);
        sharesOut = usdtIn * (10_000 - feeBps) * 1e18 / (10_000 * uint256(price));
        if (sharesOut < minSharesOut) revert Slippage(sharesOut, minSharesOut);
        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        MockStock(stock).mint(msg.sender, sharesOut);
        emit Bought(msg.sender, stock, usdtIn, sharesOut, price);
    }

    /// @notice Burn shares, receive USDT at the quoted price minus the fee, from what buyers paid in.
    function sell(
        address stock,
        uint256 sharesIn,
        uint256 minUsdtOut,
        uint128 price,
        uint40 deadline,
        bytes calldata sig
    ) external returns (uint256 usdtOut) {
        if (sharesIn == 0) revert ZeroAmount();
        _verify(stock, price, deadline, sig);
        usdtOut = sharesIn * uint256(price) * (10_000 - feeBps) / (1e18 * 10_000);
        if (usdtOut < minUsdtOut) revert Slippage(usdtOut, minUsdtOut);
        if (usdt.balanceOf(address(this)) < usdtOut) revert InsufficientLiquidity();
        MockStock(stock).burn(msg.sender, sharesIn);
        usdt.safeTransfer(msg.sender, usdtOut);
        emit Sold(msg.sender, stock, sharesIn, usdtOut, price);
    }

    function stockCount() external view returns (uint256) {
        return stocks.length;
    }

    function allStocks() external view returns (address[] memory) {
        return stocks;
    }

    /// @notice The EIP-712 digest the keeper signs for a quote.
    function quoteDigest(address stock, uint128 price, uint40 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, stock, price, deadline)));
    }

    function _verify(address stock, uint128 price, uint40 deadline, bytes calldata sig) private view {
        if (!isStock[stock]) revert UnknownStock();
        if (price == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert QuoteExpired(deadline);
        if (ECDSA.recover(quoteDigest(stock, price, deadline), sig) != keeper) revert BadQuote();
    }

    function _setFee(uint16 feeBps_) private {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
    }
}
