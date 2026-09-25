"use client";

import { useEffect } from "react";
import { erc20Abi, formatUnits, zeroAddress } from "viem";
import { useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { usd } from "@/app/verdict";
import { BUDGET_RUNS, USDT_DECIMALS, planRegistryAbi } from "@/lib/planRegistry";
import { chain } from "@/lib/wagmi";

/**
 * The agent is paid through PlanRegistry, which moves at most a plan's amount per due run from the owner.
 * Shows how much the owner has allowed and asks for more when the active plans need it.
 */
export function Funding({ owner, registry, perRun }: { owner: `0x${string}`; registry: `0x${string}`; perRun: bigint }) {
  const token = useReadContract({ address: registry, abi: planRegistryAbi, functionName: "fundingToken", chainId: chain.id });
  const t = token.data && token.data !== zeroAddress ? token.data : undefined;
  const q = { enabled: !!t, refetchInterval: 30_000 };
  const allowance = useReadContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [owner, registry], chainId: chain.id, query: q });
  const balance = useReadContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId: chain.id, query: q });
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: chain.id });
  const { switchChainAsync } = useSwitchChain();
  const { refetch } = allowance;
  useEffect(() => {
    if (receipt.isSuccess) void refetch();
  }, [receipt.isSuccess, refetch]);
  if (!t || allowance.data === undefined || perRun === 0n) return null;

  const ok = allowance.data >= perRun;
  const full = perRun * BigInt(BUDGET_RUNS);
  const low = ok && allowance.data < perRun * 3n; // fewer than three rounds left
  const fmt = (v: bigint) => usd.format(Number(formatUnits(v, USDT_DECIMALS)));
  const approve = (amount: bigint) =>
    switchChainAsync({ chainId: chain.id })
      .then(() => write.mutate({ address: t, abi: erc20Abi, functionName: "approve", args: [registry, amount], chainId: chain.id }))
      .catch(() => {});
  const busy = write.isPending || receipt.isLoading;

  return (
    <div className={`mt-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${ok ? "border-line" : "border-warn/40 bg-warn/10"}`}>
      <p className="min-w-0 flex-1">
        {ok ? (
          <span className="text-muted">
            The agent can spend up to <b className="text-white">{fmt(allowance.data)}</b> of your USDT through PlanRegistry ({Number(allowance.data / perRun)} rounds of your plans), never more than a plan&apos;s amount per run.{low && " Running low."}
          </span>
        ) : (
          <span className="text-warn">
            Your plans need {fmt(perRun)} per round but Plans may only use {fmt(allowance.data)} of your USDT, so the agent will wait instead of buying.
          </span>
        )}
        {balance.data !== undefined && balance.data < perRun && <span className="mt-1 block text-xs text-warn">Wallet balance {fmt(balance.data)}: top up (testnet: faucet in Profile).</span>}
      </p>
      {!ok || low ? (
        <button onClick={() => approve(full)} disabled={busy} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${ok ? "glass" : "bg-white text-black"}`}>
          {busy ? "Confirming…" : ok ? `Top up to ${fmt(full)}` : `Allow ${fmt(full)}`}
        </button>
      ) : (
        <button onClick={() => approve(0n)} disabled={busy} className="shrink-0 text-xs text-muted underline disabled:opacity-60" title="Stop the agent from spending your USDT; your plans will wait">
          {busy ? "Confirming…" : "Revoke"}
        </button>
      )}
    </div>
  );
}
