// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for a tokenized stock (1 token = 1 share). Only its exchange mints and burns.
contract MockStock is ERC20 {
    address public immutable exchange;
    string public ticker;

    error NotExchange();

    modifier onlyExchange() {
        if (msg.sender != exchange) revert NotExchange();
        _;
    }

    constructor(string memory name_, string memory symbol_, string memory ticker_, address exchange_)
        ERC20(name_, symbol_)
    {
        ticker = ticker_;
        exchange = exchange_;
    }

    function mint(address to, uint256 amount) external onlyExchange {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyExchange {
        _burn(from, amount);
    }
}
