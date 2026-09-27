// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVenusFaucetToken {
    function allocateTo(address to, uint256 amount) external;
}

interface IVTokenMintBehalf {
    function mintBehalf(address minter, uint256 mintAmount) external returns (uint256);
}

/// @notice Testnet helper: one call gives the caller supplied collateral on Venus (collateral minted straight into
/// Venus on their behalf, so there is nothing to approve) and a debt-token safety buffer in their wallet.
/// The caller still enters the market and borrows themselves: Venus only lets approved delegates do that.
contract VenusStarter {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_AMOUNT = 100_000e18;

    IERC20 public immutable collateral;
    IVTokenMintBehalf public immutable vCollateral;
    IVenusFaucetToken public immutable buffer;

    error TooMuch();
    error VenusError(uint256 code);

    constructor(IERC20 collateral_, IVTokenMintBehalf vCollateral_, IVenusFaucetToken buffer_) {
        collateral = collateral_;
        vCollateral = vCollateral_;
        buffer = buffer_;
    }

    function open(uint256 collateralAmount, uint256 bufferAmount) external {
        if (collateralAmount > MAX_AMOUNT || bufferAmount > MAX_AMOUNT) revert TooMuch();
        if (collateralAmount != 0) {
            IVenusFaucetToken(address(collateral)).allocateTo(address(this), collateralAmount);
            collateral.forceApprove(address(vCollateral), collateralAmount);
            uint256 code = vCollateral.mintBehalf(msg.sender, collateralAmount);
            if (code != 0) revert VenusError(code);
        }
        if (bufferAmount != 0) buffer.allocateTo(msg.sender, bufferAmount);
    }
}
