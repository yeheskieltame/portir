import { parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import deployments from "../../../contracts/deployments/venus-testnet.json";

/** Venus core pool on BSC testnet + Portir's LoanGuard (contracts/deployments/venus-testnet.json). */
export const VENUS = {
  chainId: bscTestnet.id,
  comptroller: deployments.comptroller as `0x${string}`,
  oracle: deployments.oracle as `0x${string}`,
  vUSDT: deployments.vUSDT as `0x${string}`,
  USDT: deployments.USDT as `0x${string}`, // 6 decimals on testnet
  vCAKE: deployments.vCAKE as `0x${string}`,
  CAKE: deployments.CAKE as `0x${string}`, // 18 decimals
  loanGuard: deployments.loanGuard as `0x${string}`,
  starter: deployments.starter as `0x${string}`, // testnet helper: collateral straight into Venus + a USDT buffer
};

export const USDT_DEC = 6;
export const CAKE_DEC = 18;
export const COOLDOWN = 3600;
/** The test loan: collateral minted into Venus for the user, and the buffer the guard repays from. */
export const TEST_CAKE = 1_000n * 10n ** 18n;
export const TEST_BUFFER = 500n * 10n ** 6n;

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
  "function borrowers() view returns (address[])",
]);

export const vTokenAbi = parseAbi([
  "function mint(uint256 amount) returns (uint256)",
  "function borrow(uint256 amount) returns (uint256)",
  "function repayBorrow(uint256 amount) returns (uint256)",
  "function borrowBalanceStored(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const comptrollerAbi = parseAbi([
  "function enterMarkets(address[] vTokens) returns (uint256[])",
  "function getAssetsIn(address account) view returns (address[])",
  // markets() grew fields across versions; the first four are stable: listed, collateral factor, isVenus, liquidation threshold
  "function markets(address vToken) view returns (bool, uint256, bool, uint256)",
]);

export const starterAbi = parseAbi(["function open(uint256 collateralAmount, uint256 bufferAmount)"]);

export const oracleAbi = parseAbi(["function getUnderlyingPrice(address vToken) view returns (uint256)"]);

/** Venus testnet tokens: plain ERC20 plus a public faucet. */
export const faucetTokenAbi = parseAbi([
  "function allocateTo(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);
