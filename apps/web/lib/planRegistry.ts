import { type Address, hexToString, isAddress, parseAbi, stringToHex, zeroAddress } from "viem";

// Mirrors contracts/src/PlanRegistry.sol. Keep in sync by hand; it is five functions.
export const planRegistryAbi = parseAbi([
  "struct Plan { address owner; address executor; bytes32 target; uint128 amount; uint32 interval; uint40 nextRunAt; bool smartTiming; bool active; bool once; }",
  "struct Run { uint40 at; uint8 outcome; int32 spreadBps; bytes32 txHash; string reason; }",
  "function createPlan(bytes32 target, uint128 amount, uint32 interval, uint40 firstRunAt, bool smartTiming, bool once, address executor) returns (uint256 planId)",
  "function updatePlan(uint256 planId, uint128 amount, uint32 interval, bool smartTiming)",
  "function cancelPlan(uint256 planId)",
  "function resumePlan(uint256 planId)",
  "function getPlan(uint256 planId) view returns (Plan)",
  "function planIdsOf(address owner) view returns (uint256[])",
  "function runsOf(uint256 planId) view returns (Run[])",
  "function fundingToken() view returns (address)",
]);

/** Runs of budget a new plan asks the owner to allow: the registry's allowance is spent run by run. */
export const BUDGET_RUNS = 12;

const env = (v: string | undefined): Address | undefined => (v && isAddress(v) ? v : undefined);

export const planRegistryAddress = env(process.env.NEXT_PUBLIC_PLAN_REGISTRY);
/** The Agent Studio executor's address. Until it exists, plans are owner-run (PRD §11 fallback). */
export const executorAddress = env(process.env.NEXT_PUBLIC_EXECUTOR) ?? zeroAddress;

export const OUTCOMES = ["Bought", "Waited", "Skipped"] as const;
export const CADENCES = { Weekly: 7, "Every 2 weeks": 14, Monthly: 30 } as const;
export const USDT_DECIMALS = 18; // BSC USDT is 18 decimals, unlike Ethereum's 6

export const encodeTarget = (t: string) => stringToHex(t, { size: 32 });
export const decodeTarget = (h: `0x${string}`) => hexToString(h, { size: 32 });
