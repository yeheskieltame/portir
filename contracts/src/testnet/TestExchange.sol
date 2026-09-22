// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Testnet issuer + DEX in one: sells and buys back MockStock shares at a keeper-set price.
/// The keeper mirrors mainnet on-chain prices so the Guard sees the same spreads it would on mainnet.
contract TestExchange is Ownable {
    using SafeERC20 for IERC20;

    struct Quote {
        uint128 price; // USDT per share, 18 decimals
        uint40 updatedAt;
    }

    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint16 public constant MAX_FEE_BPS = 200;

    IERC20 public immutable usdt;
    address public keeper;
    uint16 public feeBps;

    address[] public stocks;
    mapping(address stock => Quote) public quotes;
    mapping(string ticker => address) public stockOf;

    event StockAdded(address indexed stock, string ticker);
    event PriceSet(address indexed stock, uint128 price);
    event Bought(address indexed buyer, address indexed stock, uint256 usdtIn, uint256 sharesOut);
    event Sold(address indexed seller, address indexed stock, uint256 sharesIn, uint256 usdtOut);

    error NotKeeper();
    error UnknownStock();
    error DuplicateTicker();
    error StalePrice(uint40 updatedAt);
    error ZeroAmount();
    error Slippage(uint256 out, uint256 min);
    error LengthMismatch();
    error FeeTooHigh();
    error InsufficientLiquidity();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(IERC20 usdt_, address keeper_, uint16 feeBps_) Ownable(msg.sender) {
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
        stockOf[ticker] = stock;
        emit StockAdded(stock, ticker);
    }

    function setPrices(address[] calldata stocks_, uint128[] calldata prices) external onlyKeeper {
        if (stocks_.length != prices.length) revert LengthMismatch();
        for (uint256 i = 0; i < stocks_.length; i++) {
            if (quotes[stocks_[i]].updatedAt == 0 && !_isStock(stocks_[i])) revert UnknownStock();
            if (prices[i] == 0) revert ZeroAmount();
            quotes[stocks_[i]] = Quote(prices[i], uint40(block.timestamp));
            emit PriceSet(stocks_[i], prices[i]);
        }
    }

    /// @notice Pay `usdtIn`, receive shares at the current price minus the fee.
    function buy(address stock, uint256 usdtIn, uint256 minSharesOut) external returns (uint256 sharesOut) {
        if (usdtIn == 0) revert ZeroAmount();
        uint256 price = _freshPrice(stock);
        sharesOut = usdtIn * (10_000 - feeBps) * 1e18 / (10_000 * price);
        if (sharesOut < minSharesOut) revert Slippage(sharesOut, minSharesOut);
        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        MockStock(stock).mint(msg.sender, sharesOut);
        emit Bought(msg.sender, stock, usdtIn, sharesOut);
    }

    /// @notice Burn shares, receive USDT at the current price minus the fee, from what buyers paid in.
    function sell(address stock, uint256 sharesIn, uint256 minUsdtOut) external returns (uint256 usdtOut) {
        if (sharesIn == 0) revert ZeroAmount();
        uint256 price = _freshPrice(stock);
        usdtOut = sharesIn * price * (10_000 - feeBps) / (1e18 * 10_000);
        if (usdtOut < minUsdtOut) revert Slippage(usdtOut, minUsdtOut);
        if (usdt.balanceOf(address(this)) < usdtOut) revert InsufficientLiquidity();
        MockStock(stock).burn(msg.sender, sharesIn);
        usdt.safeTransfer(msg.sender, usdtOut);
        emit Sold(msg.sender, stock, sharesIn, usdtOut);
    }

    function stockCount() external view returns (uint256) {
        return stocks.length;
    }

    function allStocks() external view returns (address[] memory) {
        return stocks;
    }

    function priceOf(address stock) external view returns (uint256 price, uint40 updatedAt, bool fresh) {
        Quote memory q = quotes[stock];
        return (q.price, q.updatedAt, q.updatedAt != 0 && block.timestamp - q.updatedAt <= MAX_PRICE_AGE);
    }

    function _freshPrice(address stock) private view returns (uint256) {
        Quote memory q = quotes[stock];
        if (q.updatedAt == 0) revert UnknownStock();
        if (block.timestamp - q.updatedAt > MAX_PRICE_AGE) revert StalePrice(q.updatedAt);
        return q.price;
    }

    function _isStock(address stock) private view returns (bool) {
        for (uint256 i = 0; i < stocks.length; i++) {
            if (stocks[i] == stock) return true;
        }
        return false;
    }

    function _setFee(uint16 feeBps_) private {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
    }
}
