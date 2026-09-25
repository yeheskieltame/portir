// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for BSC USDT (18 decimals). Free money on purpose: anyone can mint, no cooldown.
contract MockUSDT is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e18;
    uint256 public constant MAX_MINT = 1_000_000e18;

    event Faucet(address indexed account, uint256 amount);

    error MintTooLarge(uint256 max);

    constructor() ERC20("Test USDT", "tUSDT") {}

    function faucet() external {
        _mintTo(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(MAX_MINT);
        _mintTo(to, amount);
    }

    function _mintTo(address to, uint256 amount) private {
        _mint(to, amount);
        emit Faucet(to, amount);
    }
}
