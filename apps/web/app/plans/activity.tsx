"use client";

import { useReadContracts } from "wagmi";
import { STOCK_NAMES } from "@/lib/catalog";
import { OUTCOMES, planRegistryAbi } from "@/lib/planRegistry";
import { chain } from "@/lib/wagmi";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const CLS = ["text-go border-go/40 bg-go/10", "text-warn border-warn/40 bg-warn/10", "text-muted border-line"];
const when = (s: number) => new Date(s * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** What the agent did across all of the user's plans, newest first: every run it recorded on-chain, with its reason. */
export function Activity({ registry, ids, targets, limit = 8 }: { registry: `0x${string}`; ids: readonly bigint[]; targets: Record<string, string>; limit?: number }) {
  const runs = useReadContracts({
    contracts: ids.map((id) => ({ address: registry, abi: planRegistryAbi, functionName: "runsOf" as const, args: [id] as const, chainId: chain.id })),
    allowFailure: true,
    query: { enabled: ids.length > 0, refetchInterval: 30_000 },
  });
  const items = (runs.data ?? [])
    .flatMap((r, i) => (r.status === "success" ? r.result.map((run) => ({ ...run, id: ids[i] })) : []))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
  if (items.length === 0) return null;
  const label = (id: bigint) => {
    const t = targets[String(id)] ?? "";
    return t.startsWith("BASKET:") ? `${t.slice(7)} basket` : (STOCK_NAMES[t] ?? t);
  };
  return (
    <section className="mt-6">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Agent activity</h2>
      <ol className="glass mt-3 divide-y divide-line rounded-3xl text-sm">
        {items.map((r, i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <span className={`mt-0.5 shrink-0 self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLS[r.outcome] ?? CLS[2]}`}>{OUTCOMES[r.outcome] ?? "?"}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{label(r.id)}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {when(r.at)}
                  {r.spreadBps !== 0 && ` · ${r.spreadBps > 0 ? "+" : ""}${(r.spreadBps / 100).toFixed(2)}% vs exchange`}
                </span>
              </p>
              {r.reason && <p className="mt-0.5 text-muted">{r.reason}</p>}
              {r.outcome === 0 && r.txHash !== ZERO_HASH && (
                <a className="mt-0.5 inline-block font-mono text-xs text-muted underline" href={`${chain.blockExplorers?.default.url}/tx/${r.txHash}`} target="_blank" rel="noopener">transaction ↗</a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">Every decision is written to PlanRegistry on BSC: what the agent bought, why it waited, when it stopped.</p>
    </section>
  );
}
