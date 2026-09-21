"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BASKETS, SAMPLE_STOCKS } from "@/lib/catalog";
import {
  CADENCES,
  OUTCOMES,
  USDT_DECIMALS,
  decodeTarget,
  encodeTarget,
  executorAddress,
  planRegistryAbi,
  planRegistryAddress,
} from "@/lib/planRegistry";
import { chain } from "@/lib/wagmi";

const DAY = 86_400;
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const field = "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2";

export default function Plans() {
  const { address } = useConnection();

  if (!planRegistryAddress) {
    return (
      <Notice>
        The plan registry is not deployed yet. Deploy <code>contracts/</code> and set{" "}
        <code>NEXT_PUBLIC_PLAN_REGISTRY</code>.
      </Notice>
    );
  }
  if (!address) return <Notice>Connect your wallet to set up a recurring investment.</Notice>;
  return <PlansFor owner={address} registry={planRegistryAddress} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-10 rounded-2xl border border-line bg-card p-5 text-sm text-muted">{children}</p>;
}

function PlansFor({ owner, registry }: { owner: `0x${string}`; registry: `0x${string}` }) {
  // chainId makes the wallet switch network before a write instead of sending it to the wrong chain.
  const contract = { address: registry, abi: planRegistryAbi, chainId: chain.id } as const;
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  const ids = useReadContract({ ...contract, functionName: "planIdsOf", args: [owner] });
  const plans = useReadContracts({
    contracts: (ids.data ?? []).map((id) => ({ ...contract, functionName: "getPlan", args: [id] }) as const),
    allowFailure: false,
  });

  // A confirmed create/cancel changes what the reads return.
  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries();
  }, [receipt.isSuccess, queryClient]);

  function create(form: FormData) {
    const days = CADENCES[form.get("cadence") as keyof typeof CADENCES];
    write.mutate({
      ...contract,
      functionName: "createPlan",
      args: [
        encodeTarget(String(form.get("target"))),
        parseUnits(String(form.get("amount")), USDT_DECIMALS),
        days * DAY,
        0, // first run: as soon as the executor sees it
        form.get("smart") === "on",
        executorAddress,
      ],
    });
  }

  const busy = write.isPending || receipt.isLoading;
  const error = write.error ?? receipt.error;

  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Invest on a schedule</h1>

      <form action={create} className="mt-4 space-y-4 rounded-2xl border border-line bg-card p-4 text-sm">
        <label className="block">
          What to buy
          <select name="target" className={field}>
            <optgroup label="Stocks">
              {SAMPLE_STOCKS.map((s) => (
                <option key={s.ticker} value={s.ticker}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Baskets">
              {BASKETS.map((b) => (
                <option key={b} value={`BASKET:${b}`}>
                  {b}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            Amount (USDT)
            <input
              name="amount"
              type="number"
              inputMode="decimal"
              min="1"
              step="any"
              defaultValue="50"
              required
              className={field}
            />
          </label>
          <label className="block">
            How often
            <select name="cadence" className={field}>
              {Object.keys(CADENCES).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3">
          <input name="smart" type="checkbox" defaultChecked className="mt-1 accent-brand" />
          <span>
            Smart timing
            <span className="block text-muted">Wait up to 48 hours for the market to open and the price to be fair.</span>
          </span>
        </label>
        <button disabled={busy} className="w-full rounded-full bg-brand py-3 font-medium text-white disabled:opacity-60">
          {busy ? "Confirming…" : "Start plan"}
        </button>
        {error && (
          <p role="alert" className="text-block">
            {"shortMessage" in error ? error.shortMessage : error.message}
          </p>
        )}
      </form>

      <h2 className="mt-8 font-medium">Your plans</h2>
      {ids.error && (
        <p role="alert" className="mt-2 text-sm text-block">
          Could not read your plans. Check that your wallet is on the right network.
        </p>
      )}
      {ids.data?.length === 0 && <p className="mt-2 text-sm text-muted">No plans yet.</p>}
      <ul className="mt-3 space-y-3">
        {plans.data?.map((plan, i) => {
          const id = ids.data![i];
          return (
            <li key={id} className="rounded-2xl border border-line bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{decodeTarget(plan.target).replace("BASKET:", "")}</p>
                  <p className="text-muted">
                    {formatUnits(plan.amount, USDT_DECIMALS)} USDT every {plan.interval / DAY} days
                    {plan.smartTiming && " · smart timing"}
                  </p>
                  <p className="text-muted">{plan.active ? `Next: ${when(plan.nextRunAt)}` : "Cancelled"}</p>
                </div>
                {plan.active && (
                  <button
                    disabled={busy}
                    className="text-block disabled:opacity-60"
                    onClick={() => write.mutate({ ...contract, functionName: "cancelPlan", args: [id] })}
                  >
                    Cancel
                  </button>
                )}
              </div>
              <Runs registry={registry} planId={id} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Runs({ registry, planId }: { registry: `0x${string}`; planId: bigint }) {
  const runs = useReadContract({
    address: registry,
    abi: planRegistryAbi,
    functionName: "runsOf",
    args: [planId],
  });
  if (!runs.data?.length) return null;
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-muted">History ({runs.data.length})</summary>
      <ol className="mt-2 space-y-2">
        {runs.data.toReversed().map((run, i) => (
          <li key={i}>
            <span className="font-medium">{OUTCOMES[run.outcome]}</span>{" "}
            <span className="text-muted">{when(run.at)}</span>
            {run.reason && <p className="text-muted">{run.reason}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
