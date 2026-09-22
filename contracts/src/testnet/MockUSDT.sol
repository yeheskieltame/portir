// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for BSC USDT (18 decimals). Anyone can draw 1,000 a day.
contract MockUSDT is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e18;
    uint40 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address account => uint40) public lastFaucetAt;

    event Faucet(address indexed account, uint256 amount);

    error FaucetCooldown(uint40 nextAt);

    constructor() ERC20("Test USDT", "tUSDT") {}

    function faucet() external {
        uint40 last = lastFaucetAt[msg.sender];
        uint40 nextAt = last + FAUCET_COOLDOWN;
        if (last != 0 && block.timestamp < nextAt) revert FaucetCooldown(nextAt);
        lastFaucetAt[msg.sender] = uint40(block.timestamp);
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }
}
