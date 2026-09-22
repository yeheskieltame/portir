import { bsc, bscTestnet } from "wagmi/chains";
import { TESTNET } from "./testnet";

/**
 * Where money moves. Prices, sessions and the Guard always come from live mainnet data;
 * the mode only decides which chain and which USDT the wallet signs against.
 *   testnet — BSC testnet, tUSDT (faucet) and TestExchange fixtures; safe to try everything.
 *   mainnet — BSC, real USDT, real stock tokens through the Binance Trading API.
 */
export type Mode = "testnet" | "mainnet";
export const MODE_COOKIE = "portir-mode";
export const DEFAULT_MODE: Mode = "testnet";

export const asMode = (v: unknown): Mode => (v === "mainnet" ? "mainnet" : "testnet");

export const NET = {
  testnet: { chain: bscTestnet, usdt: TESTNET.usdt, explorer: "https://testnet.bscscan.com", label: "BSC testnet · tUSDT" },
  mainnet: { chain: bsc, usdt: "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`, explorer: "https://bscscan.com", label: "BNB Chain · USDT" },
} as const;
