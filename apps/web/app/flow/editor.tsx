"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { useConnect, useConnection, useConnectors } from "wagmi";
import { readContract } from "wagmi/actions";
import { NoWallet } from "@/app/connect-button";
import { usd } from "@/app/verdict";
import { BASKETS, STOCK_NAMES, targetLegs } from "@/lib/catalog";
import { BUDGET_RUNS, USDT_DECIMALS, encodeTarget, executorAddress, planRegistryAbi, planRegistryAddress } from "@/lib/planRegistry";
import { type BatchCall, sendBatch, useBatchSupport } from "@/lib/wallet-batch";
import { config } from "@/lib/wagmi";
import { FlowCanvas, useFlowLayout } from "./canvas";
import { type FlowPlan, type StepKind, planFlow } from "./model";
import { useRegistryChain } from "@/app/mode";

export interface Settings {
  target: string;
  amount: string;
  days: number; // 7 | 14 | 30
  once: boolean;
  smart: boolean;
}

const TRIGGERS = [
  { label: "Every week", days: 7, once: false },
  { label: "Every 2 weeks", days: 14, once: false },
  { label: "Every month", days: 30, once: false },
  { label: "Once, when fair", days: 7, once: true },
] as const;
const DAY = 86_400;
export const labelOf = (target: string) => (target.startsWith("BASKET:") ? target.slice(7) : (STOCK_NAMES[target] ?? target));

export function useIcons(tickers: string[]) {
  const key = [...new Set(tickers)].sort();
  return useQuery({
    queryKey: ["icons", key],
    queryFn: () => fetch(`/api/icons?tickers=${key.join(",")}`).then((r) => r.json() as Promise<Record<string, string | null>>),
    staleTime: 3_600_000,
    enabled: key.length > 0,
  }).data;
}

export function legsFor(target: string, icons?: Record<string, string | null>) {
  return (targetLegs(target) ?? [{ ticker: target, weight: 1 }]).map((l) => ({ ...l, icon: icons?.[l.ticker] ?? null }));
}

/**
 * Configure a plan by tapping its steps. New plans deploy with one batch (budget approval + createPlan);
 * an existing plan can change amount, cadence and smart timing (asset and one-time are fixed on-chain).
 */
export function FlowEditor({ initial, planId, onDone }: { initial: Settings; planId?: bigint; onDone?: () => void }) {
  const chain = useRegistryChain();
  const router = useRouter();
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const [s, setS] = useState<Settings>(initial);
  const [pick, setPick] = useState<StepKind | null>(planId === undefined ? "asset" : "trigger");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const atomic = useBatchSupport(chain.id as never);
  const editingExisting = planId !== undefined;

  const legs = legsFor(s.target, useIcons(targetLegs(s.target)?.map((l) => l.ticker) ?? [s.target]));
  const plan: FlowPlan = { target: s.target, label: labelOf(s.target), amount: Number(s.amount) || 0, intervalDays: s.days, smartTiming: s.once || s.smart, once: s.once, active: true };
  const layout = useFlowLayout();
  const { nodes, edges } = planFlow(plan, undefined, legs, { editable: true, selected: pick, layout });
  const amount = Number(s.amount);
  const minAmount = legs.length > 1 ? Math.ceil(1 / Math.min(...legs.map((l) => l.weight))) : 1;
  const valid = amount >= minAmount;

  async function deploy() {
    if (!address || !planRegistryAddress) return;
    setError(null);
    try {
      const perRun = parseUnits(amount.toFixed(6), USDT_DECIMALS);
      const calls: BatchCall[] = [];
      if (editingExisting) {
        calls.push({ to: planRegistryAddress, label: "Save plan", data: encodeFunctionData({ abi: planRegistryAbi, functionName: "updatePlan", args: [planId!, perRun, s.days * DAY, s.smart] }) });
      } else {
        const token = await readContract(config, { chainId: chain.id, address: planRegistryAddress, abi: planRegistryAbi, functionName: "fundingToken" });
        if (token !== zeroAddress) {
          const have = await readContract(config, { chainId: chain.id, address: token, abi: erc20Abi, functionName: "allowance", args: [address, planRegistryAddress] });
          const need = perRun * BigInt(s.once ? 1 : BUDGET_RUNS);
          if (have < need) calls.push({ to: token, label: `Allow ${usd.format(Number(formatUnits(have + need, USDT_DECIMALS)))} for plans`, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [planRegistryAddress, have + need] }) });
        }
        calls.push({ to: planRegistryAddress, label: "Create plan", data: encodeFunctionData({ abi: planRegistryAbi, functionName: "createPlan", args: [encodeTarget(s.target), perRun, s.days * DAY, 0, s.once || s.smart, s.once, executorAddress] }) });
      }
      await sendBatch(calls, { chainId: chain.id as never, account: address, onProgress: (i, n, label) => setBusy(n > 1 ? `Step ${i} of ${n}: ${label}` : label) });
      if (editingExisting) {
        onDone?.();
      } else {
        const ids = await readContract(config, { chainId: chain.id, address: planRegistryAddress, abi: planRegistryAbi, functionName: "planIdsOf", args: [address] });
        router.push(`/plans/${ids[ids.length - 1]}`);
      }
    } catch (e) {
      setError(e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <FlowCanvas nodes={nodes} edges={edges} onPick={setPick} fitIds={layout === "tall" ? ["trigger", "asset", "market", "guard", "window"] : undefined} className="h-[560px] lg:h-[680px]" padding={layout === "wide" ? { top: 0.06, bottom: 0.06, left: 0.03, right: "318px" } : 0.08} />
      <aside className="mt-4 rounded-3xl border border-line bg-[#0b111c]/95 p-4 text-sm backdrop-blur-md lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:mt-0 lg:w-[296px] lg:overflow-y-auto">
        <Panel kind={pick} s={s} setS={setS} locked={editingExisting} minAmount={minAmount} onPick={setPick} />
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs text-muted">
            {usd.format(amount || 0)} of {labelOf(s.target)} · {s.once ? "one time, when fair" : TRIGGERS.find((t) => t.days === s.days && !t.once)?.label.toLowerCase()}
            {!s.once && (s.smart ? " · smart timing" : "")}
          </p>
          {!address ? (
            <>
              <button onClick={() => connect.mutate({ connector })} className="mt-3 w-full rounded-full bg-white py-2.5 text-sm font-medium text-black">Connect wallet to deploy</button>
              <NoWallet error={connect.error} />
            </>
          ) : (
            <>
              <button disabled={!valid || !!busy || !planRegistryAddress} onClick={() => void deploy()} className="mt-3 w-full rounded-full bg-white py-2.5 text-sm font-medium text-black disabled:opacity-50">
                {busy ?? (!valid ? `At least $${minAmount}` : editingExisting ? "Save changes" : "Deploy plan")}
              </button>
              {!editingExisting && <p className="mt-2 text-center text-[11px] text-muted">{atomic ? "1 confirmation in your wallet" : "Up to 2 confirmations: budget, then the plan"}</p>}
            </>
          )}
          {error && <p role="alert" className="mt-2 break-words text-xs text-block">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

function Panel({ kind, s, setS, locked, minAmount, onPick }: { kind: StepKind | null; s: Settings; setS: (f: (s: Settings) => Settings) => void; locked: boolean; minAmount: number; onPick: (k: StepKind) => void }) {
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-white text-black" : "glass"}`;
  if (kind === "asset")
    return (
      <>
        <h3 className="text-base">What to buy</h3>
        {locked ? (
          <p className="mt-2 text-xs text-muted">{labelOf(s.target)} is fixed for this plan. Start a new plan to buy something else.</p>
        ) : (
          <>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Baskets</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {BASKETS.map((b) => (
                <button key={b.slug} onClick={() => setS((x) => ({ ...x, target: `BASKET:${b.name}` }))} className={chip(s.target === `BASKET:${b.name}`)}>{b.name}</button>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Stocks</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.keys(STOCK_NAMES).map((t) => (
                <button key={t} onClick={() => setS((x) => ({ ...x, target: t }))} className={`${chip(s.target === t)} font-mono`}>{t}</button>
              ))}
            </div>
          </>
        )}
        <label className="mt-4 block text-xs text-muted">
          Amount {s.once ? "" : "each run "}(USDT)
          <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-1 font-mono text-2xl text-white">
            <span className="text-muted">$</span>
            <input inputMode="decimal" value={s.amount} onChange={(e) => setS((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} className="w-full bg-transparent outline-none" />
          </span>
        </label>
        {minAmount > 1 && <p className="mt-1 text-[11px] text-muted">At least ${minAmount}, so every holding gets $1 or more.</p>}
      </>
    );
  if (kind === "trigger")
    return (
      <>
        <h3 className="text-base">When it runs</h3>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {TRIGGERS.map((t) => {
            const on = s.once === t.once && (t.once || s.days === t.days);
            const disabled = locked && t.once !== s.once;
            return (
              <button key={t.label} disabled={disabled} onClick={() => setS((x) => ({ ...x, days: t.days, once: t.once }))} className={`${chip(on)} disabled:opacity-40`}>{t.label}</button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">{s.once ? "The agent checks every 15 minutes for up to 7 days and buys once, the first time the market is open and the price is fair." : "On each due date the agent checks every 15 minutes until it can buy fairly."}</p>
        {!s.once && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.smart} onChange={(e) => setS((x) => ({ ...x, smart: e.target.checked }))} className="accent-brand" />
            Smart timing (adds the “NYSE open?” step)
          </label>
        )}
        {locked && <p className="mt-2 text-[11px] text-muted">One-time vs repeating is fixed for an existing plan.</p>}
      </>
    );
  if (kind === "market")
    return (
      <>
        <h3 className="text-base">Smart timing</h3>
        <p className="mt-2 text-xs text-muted">Buy only while the NYSE is open and the price is green. Off: buy on schedule unless the Guard says BLOCK.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.once || s.smart} disabled={s.once} onChange={(e) => setS((x) => ({ ...x, smart: e.target.checked }))} className="accent-brand" />
          {s.once ? "Always on for one-time orders" : "Smart timing on"}
        </label>
      </>
    );
  return (
    <>
      <h3 className="text-base">Build it step by step</h3>
      <p className="mt-2 text-xs text-muted">Tap the steps marked “Tap to change”: what to buy, when it runs, and smart timing. The rest is what the agent does on every run, the same for every plan.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["asset", "trigger", "market"] as const).map((k) => (
          <button key={k} onClick={() => { if (k === "market") setS((x) => ({ ...x, smart: true })); onPick(k); }} className="glass rounded-full px-3 py-1.5 text-xs">
            {k === "asset" ? "What to buy" : k === "trigger" ? "When" : "Smart timing"}
          </button>
        ))}
      </div>
    </>
  );
}
