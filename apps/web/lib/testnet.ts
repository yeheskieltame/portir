import deployments from "../../../contracts/deployments/testnet.json";

/** Testnet fixtures from `contracts/deployments/testnet.json` (MockUSDT, TestExchange, one MockStock per featured and basket ticker). */
export const TESTNET = {
  usdt: deployments.usdt as `0x${string}`,
  exchange: deployments.exchange as `0x${string}`,
  keeper: deployments.keeper as `0x${string}`,
  stocks: deployments.stocks as Record<string, `0x${string}`>,
};

/** EIP-712 quote the keeper signs; the exchange settles at exactly this price until `deadline`. */
export const QUOTE_DOMAIN = { name: "Portir TestExchange", version: "1", chainId: 97, verifyingContract: TESTNET.exchange } as const;
export const QUOTE_TYPES = { Quote: [{ name: "stock", type: "address" }, { name: "price", type: "uint128" }, { name: "deadline", type: "uint40" }] } as const;

export const testExchangeAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "stock", type: "address" }, { name: "usdtIn", type: "uint256" }, { name: "minSharesOut", type: "uint256" }, { name: "price", type: "uint128" }, { name: "deadline", type: "uint40" }, { name: "sig", type: "bytes" }], outputs: [{ name: "sharesOut", type: "uint256" }] },
  { type: "function", name: "buyBatch", stateMutability: "nonpayable", inputs: [{ name: "stocks", type: "address[]" }, { name: "usdtIn", type: "uint256[]" }, { name: "minSharesOut", type: "uint256[]" }, { name: "prices", type: "uint128[]" }, { name: "deadlines", type: "uint40[]" }, { name: "sigs", type: "bytes[]" }], outputs: [{ name: "sharesOut", type: "uint256[]" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
] as const;

export const mockUsdtAbi = [
  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;
