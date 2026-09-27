// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Testnet stand-in for Venus with tokenized stocks as collateral (Venus lists TSLAB/NVDAB on mainnet but
/// has no stock markets on testnet). It speaks the Venus interface LoanGuard reads: comptroller views
/// (getAssetsIn, oracle, markets), vToken snapshots and repayBorrowBehalf. Collateral: Portir's MockStocks; debt:
/// tUSDT. Borrow limit = Σ collateral × CF, liquidation when debt > Σ collateral × LT, 50% close factor, 10% bonus,
/// like Venus' stock markets. 1 vToken = 1 underlying and no interest, to keep the test position easy to read.
/// Prices come from a keeper mirroring live stock prices; stale prices block borrow, redeem and liquidation.
contract StockLendingPool is Ownable {
    struct Market {
        bool listed;
        uint64 cf; // 1e18
        uint64 lt; // 1e18
        bool fixedUsd; // the debt stablecoin, priced at $1
        uint128 price; // USD per token, 1e18 (tokens are 18 decimals, so Venus' 1e(36 - decimals) scale)
        uint40 updatedAt;
    }

    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 public constant CLOSE_FACTOR = 0.5e18;
    uint256 public constant LIQUIDATION_BONUS = 1.1e18;

    address public keeper;
    mapping(address vToken => Market) public marketOf;
    address[] public allMarkets;
    mapping(address account => address[]) private _assetsIn;
    mapping(address account => mapping(address vToken => bool)) public entered;

    event MarketListed(address indexed vToken, address indexed underlying, uint64 cf, uint64 lt);
    event PriceSet(address indexed vToken, uint128 price);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 repaid,
        address seized,
        uint256 seizedAmount
    );

    error NotKeeper();
    error NotListed();
    error StalePrice(address vToken);
    error InsufficientCollateral();
    error NotLiquidatable();
    error TooMuchRepay(uint256 max);
    error BadParams();

    constructor(address keeper_) Ownable(msg.sender) {
        keeper = keeper_;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
    }

    function listMarket(IERC20 underlying, string calldata symbol, uint64 cf, uint64 lt, bool fixedUsd)
        external
        onlyOwner
        returns (PoolVToken vToken)
    {
        if (cf > lt || lt >= 1e18) revert BadParams();
        vToken = new PoolVToken(underlying, symbol);
        marketOf[address(vToken)] =
            Market(true, cf, lt, fixedUsd, fixedUsd ? 1e18 : 0, uint40(block.timestamp));
        allMarkets.push(address(vToken));
        emit MarketListed(address(vToken), address(underlying), cf, lt);
    }

    function setPrices(address[] calldata vTokens, uint128[] calldata prices) external {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (vTokens.length != prices.length) revert BadParams();
        for (uint256 i = 0; i < vTokens.length; i++) {
            Market storage m = marketOf[vTokens[i]];
            if (!m.listed || m.fixedUsd || prices[i] == 0) revert BadParams();
            m.price = prices[i];
            m.updatedAt = uint40(block.timestamp);
            emit PriceSet(vTokens[i], prices[i]);
        }
    }

    // ── Venus comptroller surface ─────────────────────────────────────────────

    function enterMarkets(address[] calldata vTokens) external returns (uint256[] memory results) {
        results = new uint256[](vTokens.length);
        for (uint256 i = 0; i < vTokens.length; i++) {
            _enter(msg.sender, vTokens[i]);
        }
    }

    function getAssetsIn(address account) external view returns (address[] memory) {
        return _assetsIn[account];
    }

    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    /// @dev Same word order as Venus' `markets()`: listed, collateral factor, isVenus, liquidation threshold, bonus.
    function markets(address vToken)
        external
        view
        returns (bool, uint256, bool, uint256, uint256, uint256, bool)
    {
        Market memory m = marketOf[vToken];
        return (m.listed, m.cf, true, m.lt, LIQUIDATION_BONUS, 0, true);
    }

    function oracle() external view returns (address) {
        return address(this);
    }

    function getUnderlyingPrice(address vToken) public view returns (uint256) {
        return marketOf[vToken].price;
    }

    /// @notice (collateral × CF, collateral × LT, debt) in USD 1e18.
    function accountValues(address account)
        public
        view
        returns (uint256 borrowLimit, uint256 liquidationLimit, uint256 debt)
    {
        address[] memory assets = _assetsIn[account];
        for (uint256 i = 0; i < assets.length; i++) {
            Market memory m = marketOf[assets[i]];
            PoolVToken v = PoolVToken(assets[i]);
            uint256 collateral = v.balanceOf(account) * m.price / 1e18;
            borrowLimit += collateral * m.cf / 1e18;
            liquidationLimit += collateral * m.lt / 1e18;
            debt += v.borrowBalanceStored(account) * m.price / 1e18;
        }
    }

    // ── hooks called by PoolVToken ────────────────────────────────────────────

    function borrowAllowed(address account, address vToken) external {
        if (msg.sender != vToken || !marketOf[vToken].listed) revert NotListed();
        _enter(account, vToken); // like Venus, borrowing a market enters it
        _requireFresh(account);
        (uint256 limit,, uint256 debt) = accountValues(account);
        if (debt > limit) revert InsufficientCollateral();
    }

    function redeemAllowed(address account, address vToken) external view {
        if (msg.sender != vToken || !marketOf[vToken].listed) revert NotListed();
        if (!entered[account][vToken]) return;
        _requireFresh(account);
        (uint256 limit,, uint256 debt) = accountValues(account);
        if (debt > limit) revert InsufficientCollateral();
    }

    /// @notice Repay part of an underwater borrower's debt and take their collateral at a 10% bonus.
    function liquidate(
        address borrower,
        PoolVToken debtMarket,
        uint256 repayAmount,
        PoolVToken collateralMarket
    ) external {
        Market memory d = marketOf[address(debtMarket)];
        Market memory c = marketOf[address(collateralMarket)];
        if (!d.listed || !c.listed) revert NotListed();
        _requireFresh(borrower);
        (, uint256 liqLimit, uint256 debt) = accountValues(borrower);
        if (debt <= liqLimit) revert NotLiquidatable();
        uint256 max = debtMarket.borrowBalanceStored(borrower) * CLOSE_FACTOR / 1e18;
        if (repayAmount == 0 || repayAmount > max) revert TooMuchRepay(max);
        uint256 seize = repayAmount * d.price / c.price * LIQUIDATION_BONUS / 1e18;
        debtMarket.repayFor(msg.sender, borrower, repayAmount);
        collateralMarket.seize(borrower, msg.sender, seize);
        emit Liquidated(borrower, msg.sender, repayAmount, address(collateralMarket), seize);
    }

    function _enter(address account, address vToken) private {
        if (!marketOf[vToken].listed) revert NotListed();
        if (entered[account][vToken]) return;
        entered[account][vToken] = true;
        _assetsIn[account].push(vToken);
    }

    function _requireFresh(address account) private view {
        address[] memory assets = _assetsIn[account];
        for (uint256 i = 0; i < assets.length; i++) {
            Market memory m = marketOf[assets[i]];
            if (!m.fixedUsd && (m.price == 0 || block.timestamp - m.updatedAt > MAX_PRICE_AGE)) {
                revert StalePrice(assets[i]);
            }
        }
    }
}

/// @notice One market of StockLendingPool, with the Venus vToken calls LoanGuard and the app use.
/// Returns 0 on success like Venus; failures revert with a reason instead of returning a code.
contract PoolVToken {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    StockLendingPool public immutable pool;
    string public symbol;
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf; // 1 vToken = 1 underlying
    mapping(address => uint256) private _borrows;
    uint256 public totalSupply;
    uint256 public totalBorrows;

    error NotPool();
    error InsufficientBalance();
    error InsufficientCash();

    constructor(IERC20 underlying_, string memory symbol_) {
        underlying = underlying_;
        pool = StockLendingPool(msg.sender);
        symbol = symbol_;
    }

    modifier onlyPool() {
        if (msg.sender != address(pool)) revert NotPool();
        _;
    }

    function getAccountSnapshot(address account) external view returns (uint256, uint256, uint256, uint256) {
        return (0, balanceOf[account], _borrows[account], 1e18);
    }

    function borrowBalanceStored(address account) public view returns (uint256) {
        return _borrows[account];
    }

    function borrowBalanceCurrent(address account) external view returns (uint256) {
        return _borrows[account];
    }

    function exchangeRateStored() external pure returns (uint256) {
        return 1e18;
    }

    function getCash() public view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function mint(uint256 amount) external returns (uint256) {
        return _mint(msg.sender, msg.sender, amount);
    }

    function mintBehalf(address minter, uint256 amount) external returns (uint256) {
        return _mint(msg.sender, minter, amount);
    }

    function redeemUnderlying(uint256 amount) external returns (uint256) {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        pool.redeemAllowed(msg.sender, address(this));
        underlying.safeTransfer(msg.sender, amount);
        return 0;
    }

    function borrow(uint256 amount) external returns (uint256) {
        if (getCash() < amount) revert InsufficientCash();
        _borrows[msg.sender] += amount;
        totalBorrows += amount;
        pool.borrowAllowed(msg.sender, address(this));
        underlying.safeTransfer(msg.sender, amount);
        return 0;
    }

    /// @param amount type(uint256).max repays the whole debt.
    function repayBorrow(uint256 amount) external returns (uint256) {
        _repay(msg.sender, msg.sender, amount);
        return 0;
    }

    function repayBorrowBehalf(address borrower, uint256 amount) external returns (uint256) {
        _repay(msg.sender, borrower, amount);
        return 0;
    }

    function repayFor(address payer, address borrower, uint256 amount) external onlyPool {
        _repay(payer, borrower, amount);
    }

    function seize(address borrower, address liquidator, uint256 amount) external onlyPool {
        if (balanceOf[borrower] < amount) amount = balanceOf[borrower];
        balanceOf[borrower] -= amount;
        balanceOf[liquidator] += amount;
    }

    function _mint(address payer, address minter, uint256 amount) private returns (uint256) {
        underlying.safeTransferFrom(payer, address(this), amount);
        balanceOf[minter] += amount;
        totalSupply += amount;
        return 0;
    }

    function _repay(address payer, address borrower, uint256 amount) private {
        uint256 owed = _borrows[borrower];
        if (amount > owed) amount = owed;
        _borrows[borrower] = owed - amount;
        totalBorrows -= amount;
        underlying.safeTransferFrom(payer, address(this), amount);
    }
}
