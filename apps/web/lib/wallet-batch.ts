"use client";

import { useQuery } from "@tanstack/react-query";
import { type Hex, hexToBigInt } from "viem";
import { useConnection } from "wagmi";
import { getCapabilities, getPublicClient, sendCalls, sendTransaction, switchChain, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { config } from "@/lib/wagmi";

type ChainId = (typeof config)["chains"][number]["id"];

export interface BatchCall {
  to: `0x${string}`;
  data: Hex;
  label: string;
  /** Venus vToken call: it returns an error code instead of reverting, so a non-zero result is a failure. */
  venus?: boolean;
}

/** Whether the connected wallet can send several calls as one confirmation (EIP-5792 atomic batch) on `chainId`. */
async function atomicSupported(chainId: ChainId): Promise<boolean> {
  try {
    const caps = (await getCapabilities(config, { chainId })) as { atomic?: { status?: string } };
    return caps?.atomic?.status === "supported" || caps?.atomic?.status === "ready";
  } catch {
    return false;
  }
}

export function useBatchSupport(chainId: ChainId): boolean | undefined {
  const { address, connector } = useConnection();
  return useQuery({ queryKey: ["atomic", address, connector?.id, chainId], queryFn: () => atomicSupported(chainId), enabled: !!address, staleTime: 60_000 }).data;
}

/**
 * Send `calls` in order. Batching wallets get one confirmation (atomic: all or nothing); others get one prompt per
 * call, each mined before the next (a borrow's gas estimate needs the market entry already mined).
 */
export async function sendBatch(calls: BatchCall[], { chainId, account, onProgress }: { chainId: ChainId; account: `0x${string}`; onProgress?: (i: number, n: number, label: string) => void }): Promise<{ atomic: boolean }> {
  await switchChain(config, { chainId });
  if (calls.length > 1 && (await atomicSupported(chainId))) {
    onProgress?.(1, 1, `Confirm ${calls.length} steps at once in your wallet`);
    const { id } = await sendCalls(config, { chainId, calls: calls.map(({ to, data }) => ({ to, data })), forceAtomic: true });
    const status = await waitForCallsStatus(config, { id, timeout: 180_000 });
    if (status.status !== "success") throw new Error("The batch did not go through. Nothing was changed.");
    return { atomic: true };
  }
  const client = getPublicClient(config, { chainId });
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    onProgress?.(i + 1, calls.length, c.label);
    if (c.venus && client) {
      const r = await client.call({ account, to: c.to, data: c.data });
      if (r.data && r.data !== "0x" && hexToBigInt(r.data) !== 0n) throw new Error(`Venus refused "${c.label}" (error code ${hexToBigInt(r.data)}).`);
    }
    const hash = await sendTransaction(config, { chainId, to: c.to, data: c.data });
    const receipt = await waitForTransactionReceipt(config, { chainId, hash });
    if (receipt.status !== "success") throw new Error(`"${c.label}" reverted.`);
  }
  return { atomic: false };
}
