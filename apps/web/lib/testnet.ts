import deployments from "../../../contracts/deployments/testnet.json";

/** Testnet fixtures from `contracts/deployments/testnet.json` (MockUSDT, TestExchange, one MockStock per featured ticker). */
export const TESTNET = {
  usdt: deployments.usdt as `0x${string}`,
  exchange: deployments.exchange as `0x${string}`,
  keeper: deployments.keeper as `0x${string}`,
  stocks: deployments.stocks as Record<string, `0x${string}`>,
};

export const testExchangeAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "stock", type: "address" }, { name: "usdtIn", type: "uint256" }, { name: "minSharesOut", type: "uint256" }], outputs: [{ name: "sharesOut", type: "uint256" }] },
  { type: "function", name: "priceOf", stateMutability: "view", inputs: [{ name: "stock", type: "address" }], outputs: [{ name: "price", type: "uint256" }, { name: "updatedAt", type: "uint40" }, { name: "fresh", type: "bool" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
] as const;

export const mockUsdtAbi = [
  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "lastFaucetAt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint40" }] },
] as const;
