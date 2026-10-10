"use client";

import Link from "next/link";
import { use, useMemo, useState, useSyncExternalStore } from "react";
import { formatUnits } from "viem";
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { FlowCanvas, useFlowLayout } from "@/app/flow/canvas";
import { FlowEditor, labelOf, legsFor, useIcons } from "@/app/flow/editor";
import { type FlowRun, planFlow, runState } from "@/app/flow/model";
import { usd } from "@/app/verdict";
import { targetLegs } from "@/lib/catalog";
import { OUTCOMES, USDT_DECIMALS, decodeTarget, planRegistryAbi, planRegistryAddress } from "@/lib/planRegistry";
import { useRegistryChain } from "@/app/mode";

const POLL = 30_000;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const CHIP = ["text-go border-go/40 bg-go/10", "text-warn border-warn/40 bg-warn/10", "text-muted border-line"];
const when = (s: number) => new Date(s * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const cadence = (days: number) => (days === 7 ? "every week" : days === 14 ? "every 2 weeks" : days === 30 ? "every month" : `every ${days} days`);

export default function PlanFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = /^\d+$/.test(raw) ? BigInt(raw) : null;
  if (id === null || !planRegistryAddress) return <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Plan not found.</p>;
  return <PlanFlow id={id} registry={planRegistryAddress} />;
}

function PlanFlow({ id, registry }: { id: bigint; registry: `0x${string}` }) {
  const chain = useRegistryChain();
  const contract = { address: registry, abi: planRegistryAbi, chainId: chain.id } as const;
  const { address } = useConnection();
  const [editing, setEditing] = useState(false);
  const layout = useFlowLayout();
  const now = useSyncExternalStore(
    (cb) => { const t = setInterval(cb, 60_000); return () => clearInterval(t); },
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => 0,
  );
  const plan = useReadContract({ ...contract, functionName: "getPlan", args: [id], query: { refetchInterval: POLL } });
  const runs = useReadContract({ ...contract, functionName: "runsOf", args: [id], query: { refetchInterval: POLL } });
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: chain.id });
  const p = plan.data;
  const target = p ? decodeTarget(p.target) : "";
  const icons = useIcons(target ? (targetLegs(target)?.map((l) => l.ticker) ?? [target]) : []);
  const history = useMemo(() => (runs.data ?? []).map((r) => ({ outcome: r.outcome, reason: r.reason, spreadBps: r.spreadBps, at: r.at, txHash: r.txHash })), [runs.data]);
  const last: FlowRun | undefined = history.at(-1);

  if (plan.error) return <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Plan #{String(id)} was not found on {chain.name}.</p>;
  if (!p) return <p className="mt-10 animate-pulse text-sm text-muted">Reading the plan from {chain.name}…</p>;

  const legs = legsFor(target, icons);
  const amount = Number(formatUnits(p.amount, USDT_DECIMALS));
  const flowPlan = { target, label: labelOf(target), amount, intervalDays: p.interval / 86_400, smartTiming: p.smartTiming, once: p.once, active: p.active };
  const { nodes, edges } = planFlow(flowPlan, last, legs, { layout });
  const state = runState(last, flowPlan);
  const owner = address?.toLowerCase() === p.owner.toLowerCase();
  const status = !p.active ? (p.once ? "Ended" : "Paused") : p.once ? "Watching for a fair moment" : p.nextRunAt * 1000 <= now ? "Due now" : `Next run ${when(p.nextRunAt)}`;
  const busy = write.isPending || receipt.isLoading;
  const toggle = () => write.mutate({ ...contract, functionName: p.active ? "cancelPlan" : "resumePlan", args: [id] });

  return (
    <>
      <Link href="/plans" className="mt-4 inline-block text-sm text-muted">← Plans</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Plan #{String(id)} · {target.startsWith("BASKET:") ? "Basket" : "Stock"}</p>
          <h1 className="mt-1 text-[34px] leading-[1] tracking-[-0.03em]">{labelOf(target)}</h1>
          <p className="mt-2 font-mono text-sm text-muted tabular-nums">
            {usd.format(amount)} · {p.once ? "one time, when fair" : cadence(p.interval / 86_400)}
            {p.smartTiming && !p.once && " · smart timing"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${p.active ? "border-go/40 bg-go/10 text-go" : "border-line text-muted"}`}>{status}</span>
          {owner && !editing && p.active && !p.once && <button onClick={() => setEditing(true)} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black">Edit in flow</button>}
          {owner && !(p.once && !p.active) && (
            <button disabled={busy} onClick={toggle} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">{busy ? "Confirming…" : p.active ? (p.once ? "Cancel" : "Pause") : "Resume"}</button>
          )}
        </div>
      </div>

      <div className="mt-6">
        {editing ? (
          <FlowEditor planId={id} initial={{ target, amount: String(amount), days: p.interval / 86_400, once: p.once, smart: p.smartTiming }} onDone={() => { setEditing(false); void plan.refetch(); }} />
        ) : (
          <div>
            <FlowCanvas nodes={nodes} edges={edges} fitIds={layout === "tall" ? ["trigger", "asset", "market", "guard", "window"] : undefined} className="h-[560px]" />
            <aside className="glass mt-4 rounded-3xl p-4 text-sm lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-8">
              <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">What happened</h2>
              {last ? (
                <>
                  <p className="mt-2 flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHIP[last.outcome] ?? CHIP[2]}`}>{OUTCOMES[last.outcome]}</span>
                    <span className="font-mono text-xs text-muted">{when(last.at)}</span>
                  </p>
                  <p className="mt-2 leading-relaxed">{state.note}</p>
                </>
              ) : (
                <p className="mt-2 text-muted">{state.note}</p>
              )}
              </div>
              <div className="mt-3 lg:mt-0">
              <p className="text-xs text-muted">
                {state.at === "done"
                  ? p.once ? "Bought once. The order is complete." : "The whole flow ran: bought, delivered, recorded. The next run starts on schedule."
                  : state.at === "market" ? "It stopped at “NYSE open?”. The agent checks again every 15 minutes until the market opens."
                  : state.at === "guard" ? "It stopped at “Fair price?”. The agent waits for the price to come back in line."
                  : state.at === "funding" ? "It stopped at “From your wallet”: add USDT or allow Plans to use more (Plans page)."
                  : state.at === "window" ? "No fair moment inside the window, so this run was skipped and recorded."
                  : state.at === "buy" ? "The buy failed; the money was returned and the agent tries again."
                  : "Legend: green passed, amber waiting, red stopped."}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full border border-go/40 bg-go/10 px-2 py-0.5 text-go">Passed</span>
                <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-warn">Waiting</span>
                <span className="rounded-full border border-block/40 bg-block/10 px-2 py-0.5 text-block">Stopped</span>
                <span className="rounded-full border border-line px-2 py-0.5 text-muted">Not reached</span>
              </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Every run · {history.length}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No runs yet.</p>
        ) : (
          <ol className="glass mt-3 divide-y divide-line rounded-3xl text-sm">
            {history.toReversed().map((r, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span className={`mt-0.5 shrink-0 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHIP[r.outcome] ?? CHIP[2]}`}>{OUTCOMES[r.outcome]}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-muted tabular-nums">
                    {when(r.at)}
                    {r.spreadBps !== 0 && ` · ${r.spreadBps > 0 ? "+" : ""}${(r.spreadBps / 100).toFixed(2)}% vs exchange`}
                  </p>
                  <p className="mt-0.5">{r.reason}</p>
                  {r.outcome === 0 && r.txHash !== ZERO_HASH && (
                    <a className="mt-0.5 inline-block font-mono text-xs text-muted underline" href={`${chain.blockExplorers?.default.url}/tx/${r.txHash}`} target="_blank" rel="noopener">transaction ↗</a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
