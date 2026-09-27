import { parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import pool from "../../../contracts/deployments/stockpool-testnet.json";

/**
 * Loans on BSC testnet: Portir's Venus-compatible stock lending pool (Venus has no stock markets on testnet), with the
 * MockStocks as collateral and tUSDT as debt, and a LoanGuard proxy pointed at it (contracts/deployments/stockpool-testnet.json).
 * All tokens are 18 decimals and tUSDT is priced at $1, so USD 1e18 = tUSDT units.
 */
export const POOL = {
  chainId: bscTestnet.id,
  pool: pool.pool as `0x${string}`,
  vUSDT: pool.vUSDT as `0x${string}`,
  USDT: pool.USDT as `0x${string}`,
  loanGuard: pool.loanGuard as `0x${string}`,
  markets: pool.markets as Record<string, `0x${string}`>,
};
export const TICKERS = Object.keys(POOL.markets);
export const tickerOfMarket = (vToken: string) => TICKERS.find((t) => POOL.markets[t].toLowerCase() === vToken.toLowerCase());

/** Venus core pool on BSC mainnet, where tokenized stocks are real markets (read-only card). */
export const VENUS_MAINNET = {
  comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384" as `0x${string}`,
  vTSLAB: "0x97421799419Eb782628e73e7220d8E0A207469a3" as `0x${string}`,
  TSLAB: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f" as `0x${string}`,
};

export const COOLDOWN = 3600;
export const MAX_PRICE_AGE = 3600;
export const DEFAULT_BUFFER = 500n * 10n ** 18n;
export const DEFAULT_CAP = 200n * 10n ** 18n;

/** Trigger and target as bps of the liquidation limit (10_000 = liquidatable). */
export const PROFILES = {
  Conservative: { trigger: 7000, target: 5000 },
  Balanced: { trigger: 8000, target: 6000 },
  Growth: { trigger: 8800, target: 7000 },
} as const;
export type Profile = keyof typeof PROFILES;

export const loanGuardAbi = parseAbi([
  "struct Guard { address executor; address vToken; uint16 triggerBps; uint16 targetBps; uint128 maxPerRescue; uint32 cooldown; uint40 lastRescueAt; bool active; }",
  "struct Rescue { uint40 at; uint128 amount; uint16 usedBpsBefore; uint16 usedBpsAfter; }",
  "function setGuard(address executor, address vToken, uint16 triggerBps, uint16 targetBps, uint128 maxPerRescue, uint32 cooldown)",
  "function cancelGuard()",
  "function guardOf(address borrower) view returns (Guard)",
  "function position(address borrower) view returns (uint256 debtUsd, uint256 limitUsd)",
  "function usedBps(address borrower) view returns (uint256)",
  "function rescuesOf(address borrower) view returns (Rescue[])",
]);

export const poolAbi = parseAbi([
  "function enterMarkets(address[] vTokens) returns (uint256[])",
  "function getAssetsIn(address account) view returns (address[])",
  "function accountValues(address account) view returns (uint256 borrowLimit, uint256 liquidationLimit, uint256 debt)",
  "function marketOf(address vToken) view returns (bool listed, uint64 cf, uint64 lt, bool fixedUsd, uint128 price, uint40 updatedAt)",
]);

export const vTokenAbi = parseAbi([
  "function mint(uint256 amount) returns (uint256)",
  "function borrow(uint256 amount) returns (uint256)",
  "function repayBorrow(uint256 amount) returns (uint256)",
  "function borrowBalanceStored(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function faucet()",
]);

/** Venus mainnet reads: markets() grew fields across versions; the first four are stable. */
export const venusComptrollerAbi = parseAbi([
  "function markets(address vToken) view returns (bool, uint256, bool, uint256)",
  "function oracle() view returns (address)",
]);
export const venusOracleAbi = parseAbi(["function getUnderlyingPrice(address vToken) view returns (uint256)"]);
export const symbolAbi = parseAbi(["function symbol() view returns (string)"]);
