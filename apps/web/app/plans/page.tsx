"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { formatUnits, zeroAddress } from "viem";
import { Logo } from "@/app/logo";
import { usd } from "@/app/verdict";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BASKETS, STOCK_NAMES } from "@/lib/catalog";
import {
  CADENCES,
  OUTCOMES,
  USDT_DECIMALS,
  decodeTarget,
  executorAddress,
  planRegistryAbi,
  planRegistryAddress,
} from "@/lib/planRegistry";
import { chain } from "@/lib/wagmi";

const DAY = 86_400;
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function Plans() {
  const { address } = useConnection();
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Invest on <span className="serif-italic text-[1.1em]">a schedule.</span>
      </h1>
      <p className="mt-3 text-sm text-muted">Set an amount and a cadence. The agent buys only when the market is open and the price is fair.</p>
      {!planRegistryAddress ? (
        <Notice>
          The plan registry is not deployed yet. Deploy <code>contracts/</code> and set <code>NEXT_PUBLIC_PLAN_REGISTRY</code>.
        </Notice>
      ) : !address ? (
        <Notice>Connect your wallet to set up a recurring investment.</Notice>
      ) : (
        <PlansFor owner={address} registry={planRegistryAddress} />
      )}
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">{children}</p>;
}

function PlansFor({ owner, registry }: { owner: `0x${string}`; registry: `0x${string}` }) {
  // chainId makes the wallet switch network before a write instead of sending it to the wrong chain.
  const contract = { address: registry, abi: planRegistryAbi, chainId: chain.id } as const;
  const now = useNow();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  // Writes target the registry chain; ask the wallet to switch first instead of failing with a chain mismatch.
  const onRegistry = (fn: () => void) => switchChainAsync({ chainId: chain.id }).then(fn).catch(() => {});
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

  const busy = write.isPending || receipt.isLoading;
  const error = write.error ?? receipt.error;

  return (
    <>
      <div className="lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <section className="mt-6 lg:sticky lg:top-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">New plan</h2>
        <p className="mt-2 text-sm text-muted">Pick what to buy; the amount and cadence are set right there.</p>
        <ul className="mt-3 space-y-2">
          {BASKETS.map((b) => (
            <li key={b.slug}>
              <Link href={`/basket/${b.slug}?plan`} className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm active:bg-white/5">
                <Logo src={null} name={b.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate font-mono text-xs text-muted">{b.legs.map((l) => l.ticker).join(" · ")}</span>
                </span>
                <span className="text-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.keys(STOCK_NAMES).map((t) => (
            <Link key={t} href={`/stock/${t}?plan`} className="glass rounded-full px-3 py-1.5 font-mono text-xs active:bg-white/5">{t}</Link>
          ))}
          <Link href="/" className="rounded-full px-3 py-1.5 text-xs text-muted underline">all stocks</Link>
        </div>
      </section>

      <div className="lg:mt-6">
      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-muted lg:mt-0">Your plans</h2>
      {ids.error && (
        <p role="alert" className="mt-2 text-sm text-block">
          Could not read your plans. Check that your wallet is on the right network.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-block">
          {"shortMessage" in error ? error.shortMessage : error.message}
        </p>
      )}
      {ids.data?.length === 0 && <p className="mt-2 text-sm text-muted">No plans yet.</p>}
      <ul className="mt-3 space-y-3">
        {plans.data?.map((plan, i) => {
          const id = ids.data![i];
          const target = decodeTarget(plan.target);
          const basket = target.startsWith("BASKET:");
          const label = basket ? target.slice(7) : (STOCK_NAMES[target] ?? target);
          const due = plan.nextRunAt * 1000 <= now;
          const status = !plan.active
            ? { label: "Cancelled", cls: "text-muted border-line" }
            : due
              ? { label: plan.smartTiming ? "Due · waiting for a fair window" : "Due", cls: "text-warn border-warn/40 bg-warn/10" }
              : { label: `Next in ${untilText(plan.nextRunAt, now)}`, cls: "text-go border-go/40 bg-go/10" };
          const cadence = Object.entries(CADENCES).find(([, d]) => d * DAY === plan.interval)?.[0] ?? `Every ${plan.interval / DAY} days`;
          return (
            <li key={id} className={`glass rounded-3xl p-4 text-sm ${plan.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <Logo src={null} name={label} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-medium leading-tight">
                    {label}
                    {basket && <span className="ml-2 rounded border border-line px-1 align-middle text-[10px] uppercase text-muted">Basket</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">
                    {usd.format(Number(formatUnits(plan.amount, USDT_DECIMALS)))} · {cadence}
                    {plan.smartTiming && " · smart timing"}
                  </p>
                </div>
                {plan.active && (
                  <button disabled={busy} className="text-xs text-block disabled:opacity-60" onClick={() => void onRegistry(() => write.mutate({ ...contract, functionName: "cancelPlan", args: [id] }))}>
                    Cancel
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
                {plan.active && <span className="font-mono text-xs text-muted">{when(plan.nextRunAt)}</span>}
              </div>
              {plan.active && plan.smartTiming && (
                <p className="mt-2 text-xs text-muted">The agent waits up to 48h after the due time for the market to open and the price to be fair, then buys and writes its reason here.</p>
              )}
              <Runs registry={registry} planId={id} />
            </li>
          );
        })}
      </ul>
      {ids.data && ids.data.length > 0 && executorAddress === zeroAddress && (
        <p className="mt-3 text-xs text-muted">Runs are recorded by the executor agent on BNB Agent Studio once it is live; until then plans are owner-run.</p>
      )}
      </div>
      </div>
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
  const latest = runs.data[runs.data.length - 1];
  const bought = runs.data.filter((r) => r.outcome === 0).length;
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="flex cursor-pointer items-center gap-2 text-xs">
        <Outcome outcome={latest.outcome} />
        <span className="text-muted">last run {when(latest.at)}</span>
        <span className="ml-auto font-mono text-muted">{bought}/{runs.data.length} bought</span>
      </summary>
      <ol className="mt-3 space-y-3">
        {runs.data.toReversed().map((run, i) => (
          <li key={i} className="flex gap-3">
            <Outcome outcome={run.outcome} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-muted tabular-nums">
                {when(run.at)}
                {run.spreadBps !== 0 && ` · ${run.spreadBps > 0 ? "+" : ""}${(run.spreadBps / 100).toFixed(2)}% vs exchange`}
              </p>
              {run.reason && <p className="mt-0.5 text-xs">{run.reason}</p>}
              {run.outcome === 0 && run.txHash !== ZERO_HASH && (
                <a className="mt-0.5 block font-mono text-xs text-muted underline" href={`${chain.blockExplorers?.default.url}/tx/${run.txHash}`} target="_blank" rel="noopener">transaction ↗</a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

const ZERO_HASH = `0x${"0".repeat(64)}`;
const OUTCOME_CLS = ["text-go border-go/40 bg-go/10", "text-warn border-warn/40 bg-warn/10", "text-muted border-line"];
function Outcome({ outcome }: { outcome: number }) {
  return <span className={`shrink-0 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${OUTCOME_CLS[outcome] ?? OUTCOME_CLS[2]}`}>{OUTCOMES[outcome] ?? "?"}</span>;
}

// The minute, ticking, so countdowns re-render without calling Date.now() in render.
function useNow(step = 60_000) {
  return useSyncExternalStore(
    (cb) => { const t = setInterval(cb, step); return () => clearInterval(t); },
    () => Math.floor(Date.now() / step) * step,
    () => 0,
  );
}

function untilText(at: number, now: number) {
  const s = Math.max(0, at - now / 1000);
  const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
