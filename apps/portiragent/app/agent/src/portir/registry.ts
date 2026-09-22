/**
 * PlanRegistry access. Reads through viem; writes (`recordRun`) are FIXED code:
 * the agent's wallet signs a legacy tx via the studio wallet provider and the
 * raw tx is broadcast with viem. Never exposed as an LLM tool.
 */
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import { type Address, type Hex, createPublicClient, encodeFunctionData, hexToString, http, parseAbi, stringToHex } from "viem";
import { bsc, bscTestnet } from "viem/chains";

// Mirrors contracts/src/PlanRegistry.sol (same ABI as apps/web/lib/planRegistry.ts).
export const planRegistryAbi = parseAbi([
  "struct Plan { address owner; address executor; bytes32 target; uint128 amount; uint32 interval; uint40 nextRunAt; bool smartTiming; bool active; }",
  "struct Run { uint40 at; uint8 outcome; int32 spreadBps; bytes32 txHash; string reason; }",
  "function createPlan(bytes32 target, uint128 amount, uint32 interval, uint40 firstRunAt, bool smartTiming, address executor) returns (uint256 planId)",
  "function cancelPlan(uint256 planId)",
  "function recordRun(uint256 planId, uint8 outcome, int32 spreadBps, bytes32 txHash, string reason)",
  "function planCount() view returns (uint256)",
  "function getPlan(uint256 planId) view returns (Plan)",
  "function planIdsOf(address owner) view returns (uint256[])",
  "function runsOf(uint256 planId) view returns (Run[])",
]);

export const OUTCOME = { Executed: 0, Waited: 1, Skipped: 2 } as const;
export type Outcome = keyof typeof OUTCOME;
export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export const encodeTarget = (t: string) => stringToHex(t, { size: 32 });
export const decodeTarget = (h: Hex) => hexToString(h, { size: 32 });

const chain = () => (process.env.PORTIR_REGISTRY_CHAIN === "mainnet" ? bsc : bscTestnet);
export const registryAddress = (): Address => {
  const a = process.env.PORTIR_REGISTRY;
  if (!a) throw new Error("PORTIR_REGISTRY is not set (PlanRegistry proxy address)");
  return a as Address;
};

export const client = () => createPublicClient({ chain: chain(), transport: http(process.env.PORTIR_REGISTRY_RPC) });

export type Plan = { owner: Address; executor: Address; target: Hex; amount: bigint; interval: number; nextRunAt: number; smartTiming: boolean; active: boolean };
export type Run = { at: number; outcome: number; spreadBps: number; txHash: Hex; reason: string };

export async function planCount(): Promise<number> {
  return Number(await client().readContract({ address: registryAddress(), abi: planRegistryAbi, functionName: "planCount" }));
}
export async function getPlan(id: bigint): Promise<Plan> {
  return client().readContract({ address: registryAddress(), abi: planRegistryAbi, functionName: "getPlan", args: [id] });
}
export async function runsOf(id: bigint): Promise<readonly Run[]> {
  return client().readContract({ address: registryAddress(), abi: planRegistryAbi, functionName: "runsOf", args: [id] });
}
export async function planIdsOf(owner: Address): Promise<readonly bigint[]> {
  return client().readContract({ address: registryAddress(), abi: planRegistryAbi, functionName: "planIdsOf", args: [owner] });
}

/** Sign a call with the agent wallet (legacy tx via the studio provider) and broadcast it. Fixed code, never an LLM tool. */
export async function sendTx(to: Address, data: Hex): Promise<Hex> {
  const wallet = getWallet();
  const from = wallet.address as Address;
  const pc = client();
  const [nonce, gasPrice, gas] = await Promise.all([
    pc.getTransactionCount({ address: from, blockTag: "pending" }),
    pc.getGasPrice(),
    pc.estimateGas({ account: from, to, data }),
  ]);
  const signed = await wallet.signTransaction({ to, data, nonce, gasPrice, gas: (gas * 12n) / 10n, value: 0n, chainId: chain().id });
  const hash = await pc.sendRawTransaction({ serializedTransaction: signed.rawTransaction });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
  return hash;
}

/** `recordRun` with the agent wallet. Returns the tx hash. */
export function recordRun(planId: bigint, outcome: Outcome, spreadBps: number, txHash: Hex, reason: string): Promise<Hex> {
  return sendTx(registryAddress(), encodeFunctionData({ abi: planRegistryAbi, functionName: "recordRun", args: [planId, OUTCOME[outcome], Math.round(spreadBps), txHash, reason.slice(0, 200)] }));
}

/** Calldata for a user's wallet to create a plan bound to this agent as executor. */
export function prepareCreatePlan(input: { target: string; usdt: number; intervalDays: number; smartTiming: boolean }) {
  const data = encodeFunctionData({
    abi: planRegistryAbi,
    functionName: "createPlan",
    args: [encodeTarget(input.target), BigInt(Math.round(input.usdt * 1e6)) * 10n ** 12n, input.intervalDays * 86_400, 0, input.smartTiming, getWallet().address as Address],
  });
  return { chainId: chain().id, to: registryAddress(), data, value: "0" };
}
