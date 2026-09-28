/**
 * Plan money, both chains: the owner approves PlanRegistry (never this agent) for the registry's funding token;
 * each due run the agent pulls at most the plan amount through the registry and gives back what it did not spend.
 */
import { type Address, encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { client, planRegistryAbi, registryAddress, sendTx } from "./registry.js";

let token: Address | undefined;
export const fundingToken = async (): Promise<Address> =>
  (token ??= await client().readContract({ address: registryAddress(), abi: planRegistryAbi, functionName: "fundingToken" }));

export const agentAddress = async () => (await import("@bnbagent/studio-runtime/wallet")).getWallet().address as Address;
export const wei = (usdt: number) => parseUnits(usdt.toFixed(6), 18); // BSC USDT and tUSDT are 18 decimals
const fmt = (v: bigint) => `$${(Number(v / 10n ** 16n) / 100).toFixed(2)}`;

/** Why the owner cannot fund `usdt` right now (balance, or allowance to PlanRegistry), or null if they can. */
export async function fundingProblem(owner: Address, usdt: number): Promise<string | null> {
  const pc = client();
  const t = await fundingToken();
  const need = wei(usdt);
  const [balance, allowance] = await Promise.all([
    pc.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    pc.readContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [owner, registryAddress()] }),
  ]);
  if (balance < need) return `Your wallet has ${fmt(balance)} USDT, the order needs ${fmt(need)}.`;
  if (allowance < need) return `Plans may spend ${fmt(allowance)} of your USDT, the order needs ${fmt(need)}. Allow it on the Plans page.`;
  return null;
}

/** Pull this run's budget from the owner (the registry enforces: executor only, due, at most plan.amount). */
export const pullFunds = (planId: bigint, usdt: number) =>
  sendTx(registryAddress(), encodeFunctionData({ abi: planRegistryAbi, functionName: "pullFunds", args: [planId, wei(usdt)] }));

/** Give unspent money back to the owner through the registry, which frees the run's budget for a retry. */
export async function returnFunds(planId: bigint, usdt: number): Promise<void> {
  const t = await fundingToken();
  const amount = wei(usdt);
  const allowance = await client().readContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [await agentAddress(), registryAddress()] });
  if (allowance < amount) await sendTx(t, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [registryAddress(), 2n ** 255n] }));
  await sendTx(registryAddress(), encodeFunctionData({ abi: planRegistryAbi, functionName: "returnFunds", args: [planId, amount] }));
}

/** Move pulled money from the agent's signer to another address it controls (the Agentic Wallet on mainnet). */
export async function forward(to: Address, usdt: number) {
  return sendTx(await fundingToken(), encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, wei(usdt)] }));
}
