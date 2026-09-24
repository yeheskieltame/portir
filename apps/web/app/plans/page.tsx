"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { BasketCard, basketImage } from "@/app/basket-card";
import { Logo } from "@/app/logo";
import type { PlanProposal } from "@/app/api/agent/route";
import { AgentChat } from "./agent-chat";
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
  encodeTarget,
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
  const [editing, setEditing] = useState<bigint | null>(null);
  const call = (functionName: "cancelPlan" | "resumePlan", id: bigint) => void onRegistry(() => write.mutate({ ...contract, functionName, args: [id] }));
  const startPlan = (p: PlanProposal) =>
    void onRegistry(() => write.mutate({ ...contract, functionName: "createPlan", args: [encodeTarget(p.target), parseUnits(String(p.usdt), USDT_DECIMALS), p.intervalDays * DAY, 0, p.smartTiming, p.once, executorAddress] }));
  const planTickers = (plans.data ?? []).map((p) => decodeTarget(p.target)).filter((t) => !t.startsWith("BASKET:"));
  const iconTickers = [...new Set([...BASKETS.flatMap((b) => b.legs.map((l) => l.ticker)), ...Object.keys(STOCK_NAMES), ...planTickers])].sort();
  const icons = useQuery({
    queryKey: ["icons", iconTickers],
    queryFn: () => fetch(`/api/icons?tickers=${iconTickers.join(",")}`).then((r) => r.json() as Promise<Record<string, string | null>>),
    staleTime: 3_600_000,
  }).data;
  const active = (plans.data ?? []).filter((p) => p.active);
  const perMonth = active.reduce((n, p) => n + (Number(formatUnits(p.amount, USDT_DECIMALS)) * 30) / (p.interval / DAY), 0);
  const nextRun = active.map((p) => p.nextRunAt).filter((t) => t * 1000 > now).sort((a, b) => a - b)[0];

  return (
    <>
      <AgentChat wallet={owner} onStart={startPlan} busy={busy} />
      <div className="mt-8 lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <section className="lg:sticky lg:top-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Or pick what to buy</h2>
        <p className="mt-2 text-sm text-muted">Amount and cadence come next, on the same screen.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {BASKETS.map((b) => (
            <BasketCard key={b.slug} basket={b} icons={icons} href={`/basket/${b.slug}?plan`} aspect="aspect-[4/3]" />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.keys(STOCK_NAMES).map((t) => (
            <Link key={t} href={`/stock/${t}?plan`} className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3 font-mono text-xs active:bg-white/5">
              <Logo src={icons?.[t] ?? null} name={t} size={22} />
              {t}
            </Link>
          ))}
          <Link href="/" className="rounded-full px-3 py-1.5 text-xs text-muted underline">all stocks</Link>
        </div>
      </section>

      <div className="lg:mt-6">
      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-muted lg:mt-0">Your plans</h2>
      {active.length > 0 && (
        <dl className="glass mt-3 grid grid-cols-3 divide-x divide-line rounded-3xl text-sm">
          <Stat label="Active" value={String(active.length)} />
          <Stat label="Per month" value={usd.format(perMonth)} />
          <Stat label="Next run" value={nextRun ? untilText(nextRun, now) : "due"} />
        </dl>
      )}
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
            ? { label: plan.once ? "Done" : "Paused", cls: "text-muted border-line" }
            : plan.once
              ? { label: "Watching · buys once the price is fair", cls: "text-warn border-warn/40 bg-warn/10" }
              : due
                ? { label: plan.smartTiming ? "Due · waiting for a fair window" : "Due", cls: "text-warn border-warn/40 bg-warn/10" }
                : { label: `Next in ${untilText(plan.nextRunAt, now)}`, cls: "text-go border-go/40 bg-go/10" };
          const cadence = Object.entries(CADENCES).find(([, d]) => d * DAY === plan.interval)?.[0] ?? `Every ${plan.interval / DAY} days`;
          return (
            <li key={id} className={`glass rounded-3xl p-4 text-sm ${plan.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                {basket && BASKETS.some((b) => b.name === label) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={basketImage(BASKETS.find((b) => b.name === label)!.slug)} alt="" className="size-11 shrink-0 rounded-2xl object-cover" />
                ) : (
                  <Logo src={icons?.[target] ?? null} name={label} size={44} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-medium leading-tight">
                    {label}
                    {basket && <span className="ml-2 rounded border border-line px-1 align-middle text-[10px] uppercase text-muted">Basket</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">
                    {usd.format(Number(formatUnits(plan.amount, USDT_DECIMALS)))} · {plan.once ? "one time, when fair" : cadence}
                    {plan.smartTiming && !plan.once && " · smart timing"}
                  </p>
                </div>
                <span className="flex shrink-0 gap-1">
                  {plan.active ? (
                    <>
                      {!plan.once && <button disabled={busy} onClick={() => setEditing(editing === id ? null : id)} className="glass rounded-full px-3 py-1 text-xs disabled:opacity-60">{editing === id ? "Close" : "Edit"}</button>}
                      <button disabled={busy} onClick={() => call("cancelPlan", id)} className="rounded-full px-3 py-1 text-xs text-warn disabled:opacity-60">{plan.once ? "Cancel" : "Pause"}</button>
                    </>
                  ) : plan.once ? null : (
                    <button disabled={busy} onClick={() => call("resumePlan", id)} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-60">Resume</button>
                  )}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
                {plan.active && !plan.once && <span className="font-mono text-xs text-muted">{when(plan.nextRunAt)}</span>}
              </div>
              {plan.active && plan.once && (
                <p className="mt-2 text-xs text-muted">The agent checks every 15 minutes for up to 7 days. The first time the market is open and the price is fair it buys, writes its reason here, and the order is done.</p>
              )}
              {plan.active && plan.smartTiming && !plan.once && (
                <p className="mt-2 text-xs text-muted">The agent waits up to 48h after the due time for the market to open and the price to be fair, then buys and writes its reason here.</p>
              )}
              {editing === id && (
                <PlanEditor
                  plan={plan}
                  busy={busy}
                  onSave={(amount, days, smart) => { setEditing(null); void onRegistry(() => write.mutate({ ...contract, functionName: "updatePlan", args: [id, parseUnits(amount, USDT_DECIMALS), days * DAY, smart] })); }}
                />
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

/** Change amount, cadence or smart timing in place; the next run date stays. */
function PlanEditor({ plan, busy, onSave }: { plan: { amount: bigint; interval: number; smartTiming: boolean }; busy: boolean; onSave: (amount: string, days: number, smart: boolean) => void }) {
  const [amount, setAmount] = useState(formatUnits(plan.amount, USDT_DECIMALS));
  const [days, setDays] = useState(plan.interval / DAY);
  const [smart, setSmart] = useState(plan.smartTiming);
  const valid = Number(amount) >= 1;
  return (
    <div className="animate-rise mt-3 rounded-2xl border border-line p-3">
      <label className="block text-xs text-muted">
        Amount each time (USDT)
        <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-1 font-mono text-2xl text-white">
          <span className="text-muted">$</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="w-full bg-transparent outline-none" />
        </span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(CADENCES).map(([label, d]) => (
          <button key={label} onClick={() => setDays(d)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${d === days ? "bg-white text-black" : "glass"}`}>{label}</button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} className="accent-brand" />
        Smart timing · wait up to 48h for the market to open and a fair price
      </label>
      <button disabled={!valid || busy} onClick={() => onSave(amount, days, smart)} className="mt-3 w-full rounded-full bg-white py-2 text-xs font-medium text-black disabled:opacity-50">
        {busy ? "Confirming…" : "Save changes"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums">{value}</dd>
    </div>
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
        <span className="ml-auto flex items-center gap-2 font-mono text-muted">
          <span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-go" style={{ width: `${(bought / runs.data.length) * 100}%` }} /></span>
          {bought}/{runs.data.length} bought
        </span>
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
