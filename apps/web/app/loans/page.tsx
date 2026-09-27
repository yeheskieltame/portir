"use client";

import { useState } from "react";
import { type Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { readContract, simulateContract, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useMode } from "@/app/mode";
import { usd } from "@/app/verdict";
import { executorAddress } from "@/lib/planRegistry";
import { CAKE_DEC, COOLDOWN, PROFILES, type Profile, USDT_DEC, VENUS, comptrollerAbi, faucetTokenAbi, loanGuardAbi, oracleAbi, vTokenAbi } from "@/lib/venus";
import { config } from "@/lib/wagmi";

const POLL = 15_000;
const chainId = VENUS.chainId;
const usdOf = (v: bigint) => usd.format(Number(formatUnits(v, 18)));
const usdt = (v: bigint) => Number(formatUnits(v, USDT_DEC)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const when = (s: number) => new Date(s * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const field = "field";

export default function Loans() {
  const { address } = useConnection();
  const mode = useMode();
  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em] lg:text-[44px]">
        Borrow against it, <span className="serif-italic text-[1.1em]">without liquidation.</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Portir&apos;s agent watches your Venus loan every 5 minutes and repays from your own safety buffer before you get close to liquidation. The LoanGuard contract only lets it repay when your position really is past your trigger, at most your cap per rescue.
      </p>
      {mode === "mainnet" && (
        <p className="mt-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-xs text-warn">
          Loan Guard runs on BSC testnet for now. Venus lists tokenized stocks like NVDAB on mainnet; it is the same contract, and the next step.
        </p>
      )}
      {!address ? (
        <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Connect your wallet to see your Venus position and turn on the guard.</p>
      ) : (
        <LoansFor owner={address} />
      )}
    </>
  );
}

function LoansFor({ owner }: { owner: `0x${string}` }) {
  const q = { refetchInterval: POLL };
  const reads = useReadContracts({
    allowFailure: true,
    query: q,
    contracts: [
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "position", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "usedBps", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "guardOf", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "rescuesOf", args: [owner], chainId },
      { address: VENUS.CAKE, abi: faucetTokenAbi, functionName: "balanceOf", args: [owner], chainId },
      { address: VENUS.USDT, abi: faucetTokenAbi, functionName: "balanceOf", args: [owner], chainId },
      { address: VENUS.USDT, abi: faucetTokenAbi, functionName: "allowance", args: [owner, VENUS.loanGuard], chainId },
      { address: VENUS.vCAKE, abi: vTokenAbi, functionName: "balanceOf", args: [owner], chainId },
      { address: VENUS.comptroller, abi: comptrollerAbi, functionName: "getAssetsIn", args: [owner], chainId },
      { address: VENUS.vUSDT, abi: vTokenAbi, functionName: "borrowBalanceStored", args: [owner], chainId },
      { address: VENUS.oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [VENUS.vUSDT], chainId },
    ],
  });
  const d = reads.data;
  const ok = <T,>(i: number) => (d?.[i]?.status === "success" ? (d[i].result as T) : undefined);
  const pos = ok<readonly [bigint, bigint]>(0);
  const debt = pos?.[0] ?? 0n;
  const limit = pos?.[1] ?? 0n;
  const used = ok<bigint>(1) ?? 0n;
  const guard = ok<{ executor: `0x${string}`; triggerBps: number; targetBps: number; maxPerRescue: bigint; cooldown: number; lastRescueAt: number; active: boolean }>(2);
  const rescues = ok<readonly { at: number; amount: bigint; usedBpsBefore: number; usedBpsAfter: number }[]>(3) ?? [];
  const cake = ok<bigint>(4) ?? 0n;
  const buffer = ok<bigint>(5) ?? 0n;
  const allowed = ok<bigint>(6) ?? 0n;
  const vCake = ok<bigint>(7) ?? 0n;
  const entered = (ok<readonly `0x${string}`[]>(8) ?? []).some((a) => a.toLowerCase() === VENUS.vCAKE.toLowerCase());
  const borrowed = ok<bigint>(9) ?? 0n;
  const usdtPrice = ok<bigint>(10) ?? 0n;
  const loaded = !!pos;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Switch to BSC testnet, then run the writes in order. A Venus call is simulated first: vTokens return error codes. */
  async function act(label: string, steps: (() => Promise<unknown>)[]) {
    setError(null);
    setBusy(label);
    try {
      await switchChain(config, { chainId });
      for (const step of steps) await step();
      await reads.refetch();
    } catch (e) {
      setError(e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  const send = async (address: `0x${string}`, abi: Abi, functionName: string, args: readonly unknown[], venus = false) => {
    if (venus) {
      const sim = await simulateContract(config, { chainId, account: owner, address, abi, functionName, args });
      if (typeof sim.result === "bigint" && sim.result !== 0n) throw new Error(`Venus refused ${functionName} (error code ${sim.result}).`);
    }
    const hash = await writeContract(config, { chainId, address, abi, functionName, args });
    const r = await waitForTransactionReceipt(config, { chainId, hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted.`);
  };
  const approveIfNeeded = async (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
    const have = await readContract(config, { chainId, address: token, abi: faucetTokenAbi, functionName: "allowance", args: [owner, spender] });
    if (have < amount) await send(token, faucetTokenAbi, "approve", [spender, amount]);
  };
  /** USDT (6 dec) worth `usd18` at the Venus oracle price (scaled 1e30 for a 6-decimal token). */
  const usdtFor = (usd18: bigint) => (usdtPrice > 0n ? (usd18 * 10n ** 18n) / usdtPrice : 0n);

  const profile = guard?.active ? { trigger: guard.triggerBps, target: guard.targetBps } : PROFILES.Balanced;
  const pct = used >= 10_000n ? 100 : Number(used) / 100;
  const status =
    used >= 10_000n ? { label: "Liquidatable", cls: "text-block border-block/40 bg-block/10" }
    : used >= BigInt(profile.trigger) ? { label: "At risk", cls: "text-block border-block/40 bg-block/10" }
    : used >= BigInt(profile.target) ? { label: "Careful", cls: "text-warn border-warn/40 bg-warn/10" }
    : { label: "Safe", cls: "text-go border-go/40 bg-go/10" };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8">
      <div>
        {/* Position */}
        <section className="glass mt-6 rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Venus position · BSC testnet</h2>
            {loaded && debt > 0n && <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted">Debt</dt>
              <dd className="mt-1 font-mono text-2xl tabular-nums">{loaded ? usdOf(debt) : "…"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Liquidation limit</dt>
              <dd className="mt-1 font-mono text-2xl tabular-nums">{loaded ? usdOf(limit) : "…"}</dd>
            </div>
          </dl>
          <div className="mt-6">
            <div className="flex justify-between text-xs text-muted">
              <span>Limit used</span>
              <span className="font-mono tabular-nums text-white">{loaded && debt > 0n ? `${pct.toFixed(1)}%` : "—"}</span>
            </div>
            <div className="relative mt-2 h-3 rounded-full bg-white/10">
              <div className={`h-full rounded-full ${status.label === "Safe" ? "bg-go" : status.label === "Careful" ? "bg-warn" : "bg-block"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              {guard?.active && (
                <>
                  <Marker at={guard.targetBps / 100} label="target" />
                  <Marker at={guard.triggerBps / 100} label="trigger" />
                </>
              )}
            </div>
            <div className="mt-6 flex justify-between font-mono text-[10px] text-muted">
              <span>0%</span>
              <span>100% · liquidation</span>
            </div>
          </div>
          {loaded && debt > 0n && (
            <p className="mt-3 text-xs text-muted">
              Borrowed {usdt(borrowed)} USDT against {Number(formatUnits(vCake, 8)).toLocaleString("en-US", { maximumFractionDigits: 2 })} vCAKE. Prices come from the Venus oracle, the same one that decides liquidations.
            </p>
          )}
        </section>

        {/* Test position */}
        {loaded && debt === 0n && (
          <OpenPosition
            cake={cake}
            supplied={vCake > 0n && entered}
            limit={limit}
            buffer={buffer}
            busy={busy}
            onFaucetCake={() => act("cake", [() => send(VENUS.CAKE, faucetTokenAbi, "allocateTo", [owner, parseUnits("1000", CAKE_DEC)])])}
            onSupply={() =>
              act("supply", [
                () => approveIfNeeded(VENUS.CAKE, VENUS.vCAKE, cake),
                () => send(VENUS.vCAKE, vTokenAbi, "mint", [cake], true),
                () => (entered ? Promise.resolve() : send(VENUS.comptroller, comptrollerAbi, "enterMarkets", [[VENUS.vCAKE]])),
              ])
            }
            onBorrow={(share) => act("borrow", [() => send(VENUS.vUSDT, vTokenAbi, "borrow", [usdtFor((limit * BigInt(share)) / 100n)], true)])}
            onFaucetUsdt={() => act("usdt", [() => send(VENUS.USDT, faucetTokenAbi, "allocateTo", [owner, parseUnits("500", USDT_DEC)])])}
          />
        )}

        {/* Demo controls */}
        {loaded && debt > 0n && (
          <section className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono uppercase tracking-[0.12em] text-muted">Testnet demo</span>
            <button disabled={!!busy} onClick={() => act("more", [() => send(VENUS.vUSDT, vTokenAbi, "borrow", [usdtFor(limit / 10n)], true)])} className="glass rounded-full px-3 py-1.5 disabled:opacity-50">
              {busy === "more" ? "Borrowing…" : "Borrow 10% more"}
            </button>
            <button
              disabled={!!busy}
              onClick={() => {
                const amt = usdtFor(limit / 10n) > borrowed ? borrowed : usdtFor(limit / 10n);
                void act("repay", [() => approveIfNeeded(VENUS.USDT, VENUS.vUSDT, amt), () => send(VENUS.vUSDT, vTokenAbi, "repayBorrow", [amt], true)]);
              }}
              className="glass rounded-full px-3 py-1.5 disabled:opacity-50"
            >
              {busy === "repay" ? "Repaying…" : "Repay 10%"}
            </button>
            <span className="text-muted">Push it past your trigger and watch the agent step in on its next check.</span>
          </section>
        )}

        {error && <p role="alert" className="mt-3 break-words text-sm text-block">{error}</p>}

        <History rescues={rescues} />
      </div>

      <GuardCard
        guard={guard}
        buffer={buffer}
        allowed={allowed}
        busy={busy}
        onApprove={(amount) => act("approve", [() => send(VENUS.USDT, faucetTokenAbi, "approve", [VENUS.loanGuard, amount])])}
        onEnable={(p, cap) =>
          act("enable", [() => send(VENUS.loanGuard, loanGuardAbi, "setGuard", [executorAddress, VENUS.vUSDT, PROFILES[p].trigger, PROFILES[p].target, cap, COOLDOWN])])
        }
        onDisable={() => act("disable", [() => send(VENUS.loanGuard, loanGuardAbi, "cancelGuard", [])])}
      />
    </div>
  );
}

function Marker({ at, label }: { at: number; label: string }) {
  return (
    <span className="absolute top-0 h-3 w-0.5 bg-white" style={{ left: `${at}%` }}>
      <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-muted">
        {label} {at}%
      </span>
    </span>
  );
}

function OpenPosition(p: {
  cake: bigint;
  supplied: boolean;
  limit: bigint;
  buffer: bigint;
  busy: string | null;
  onFaucetCake: () => void;
  onSupply: () => void;
  onBorrow: (share: number) => void;
  onFaucetUsdt: () => void;
}) {
  const [share, setShare] = useState(70);
  const steps = [
    { done: p.cake > 0n || p.supplied, title: "Get 1,000 test CAKE", note: "Venus testnet faucet", action: p.onFaucetCake, key: "cake", cta: "Get CAKE" },
    { done: p.supplied, title: "Supply CAKE as collateral", note: "approve, supply, enable as collateral", action: p.onSupply, key: "supply", cta: "Supply", disabled: p.cake === 0n },
    { done: false, title: "Borrow USDT", note: `${share}% of your liquidation limit (${usd.format(Number(formatUnits((p.limit * BigInt(share)) / 100n, 18)))})`, action: () => p.onBorrow(share), key: "borrow", cta: "Borrow", disabled: !p.supplied },
    { done: p.buffer >= parseUnits("500", USDT_DEC), title: "Get 500 test USDT as a safety buffer", note: "the guard repays from this", action: p.onFaucetUsdt, key: "usdt", cta: "Get USDT" },
  ];
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Open a test position</h2>
      <p className="mt-1 text-sm text-muted">No loan yet. Four steps on Venus testnet, all free.</p>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs ${s.done ? "border-go/50 bg-go/10 text-go" : "border-line text-muted"}`}>{s.done ? "✓" : i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{s.title}</span>
              <span className="block text-xs text-muted">{s.note}</span>
              {s.key === "borrow" && p.supplied && (
                <input type="range" min={10} max={95} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} className="mt-2 w-full accent-brand" aria-label="Share of the liquidation limit" />
              )}
            </span>
            <button onClick={s.action} disabled={!!p.busy || s.disabled || (s.done && s.key !== "usdt")} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40">
              {p.busy === s.key ? "…" : s.cta}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GuardCard(p: {
  guard?: { executor: `0x${string}`; triggerBps: number; targetBps: number; maxPerRescue: bigint; cooldown: number; lastRescueAt: number; active: boolean };
  buffer: bigint;
  allowed: bigint;
  busy: string | null;
  onApprove: (amount: bigint) => void;
  onEnable: (p: Profile, cap: bigint) => void;
  onDisable: () => void;
}) {
  const [profile, setProfile] = useState<Profile>("Balanced");
  const [cap, setCap] = useState("200");
  const [budget, setBudget] = useState("500");
  const capUnits = Number(cap) > 0 ? parseUnits(cap, USDT_DEC) : 0n;
  const budgetUnits = Number(budget) > 0 ? parseUnits(budget, USDT_DEC) : 0n;
  const active = !!p.guard?.active;
  const noExecutor = executorAddress === zeroAddress;

  return (
    <section className="glass mt-6 rounded-3xl p-5 lg:sticky lg:top-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg">Loan Guard</h2>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${active ? "border-go/40 bg-go/10 text-go" : "border-line text-muted"}`}>{active ? "On" : "Off"}</span>
      </div>

      {active ? (
        <dl className="mt-4 divide-y divide-line rounded-2xl border border-line text-sm">
          <Row k="Rescues past" v={`${p.guard!.triggerBps / 100}% of the limit`} />
          <Row k="Brings you back to" v={`${p.guard!.targetBps / 100}%`} />
          <Row k="At most per rescue" v={`${usdt(p.guard!.maxPerRescue)} USDT`} />
          <Row k="Cooldown" v={`${Math.round(p.guard!.cooldown / 60)} min`} />
          {p.guard!.lastRescueAt > 0 && <Row k="Last rescue" v={when(p.guard!.lastRescueAt)} />}
        </dl>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Pick how close to liquidation you are willing to get.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(Object.keys(PROFILES) as Profile[]).map((k) => (
              <button key={k} onClick={() => setProfile(k)} className={`rounded-2xl border px-2 py-2 text-left text-xs ${k === profile ? "border-white bg-white text-black" : "border-line"}`}>
                <span className="block font-medium">{k}</span>
                <span className={`block font-mono ${k === profile ? "text-black/60" : "text-muted"}`}>
                  {PROFILES[k].trigger / 100}% → {PROFILES[k].target / 100}%
                </span>
              </button>
            ))}
          </div>
          <label className="mt-4 block text-xs text-muted">
            At most per rescue (USDT)
            <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} className={field} />
          </label>
        </>
      )}

      <div className="mt-4 rounded-2xl border border-line p-3 text-sm">
        <p className="text-muted">
          Safety buffer: <b className="text-white">{usdt(p.buffer)} USDT</b> in your wallet · the guard may use <b className="text-white">{usdt(p.allowed)}</b>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} className="w-24 rounded-full border border-line bg-transparent px-3 py-1.5 font-mono text-xs outline-none" aria-label="Buffer to allow (USDT)" />
          <button disabled={!!p.busy || budgetUnits === 0n} onClick={() => p.onApprove(budgetUnits)} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            {p.busy === "approve" ? "Confirming…" : p.allowed > 0n ? "Change allowance" : "Allow buffer"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Money moves from your wallet straight to Venus on a rescue. It never sits with the agent.</p>
      </div>

      {active ? (
        <button disabled={!!p.busy} onClick={p.onDisable} className="mt-4 w-full rounded-full border border-block/40 py-2.5 text-sm text-block disabled:opacity-50">
          {p.busy === "disable" ? "Confirming…" : "Turn off"}
        </button>
      ) : (
        <button disabled={!!p.busy || capUnits === 0n || noExecutor} onClick={() => p.onEnable(profile, capUnits)} className="mt-4 w-full rounded-full bg-white py-2.5 text-sm font-medium text-black disabled:opacity-50">
          {p.busy === "enable" ? "Confirming…" : "Turn on guard"}
        </button>
      )}
      {noExecutor && <p className="mt-2 text-xs text-warn">The executor agent is not configured (NEXT_PUBLIC_EXECUTOR).</p>}
      {!active && p.allowed === 0n && <p className="mt-2 text-xs text-muted">Allow a buffer too, or the agent will have nothing to repay with.</p>}
    </section>
  );
}

function History({ rescues }: { rescues: readonly { at: number; amount: bigint; usedBpsBefore: number; usedBpsAfter: number }[] }) {
  const items = [...rescues].reverse();
  return (
    <section className="mt-6">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Rescues</h2>
      {items.length === 0 ? (
        <p className="glass mt-3 rounded-3xl px-4 py-3 text-sm text-muted">No rescues yet — the agent steps in only past your trigger.</p>
      ) : (
        <ol className="glass mt-3 divide-y divide-line rounded-3xl text-sm">
          {items.map((r, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="shrink-0 rounded-full border border-go/40 bg-go/10 px-2 py-0.5 text-[11px] font-medium text-go">Repaid</span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono tabular-nums">{usdt(r.amount)} USDT</span>
                <span className="block text-xs text-muted">{when(r.at)}</span>
              </span>
              <span className="font-mono text-xs tabular-nums">
                <span className="text-block">{(r.usedBpsBefore / 100).toFixed(1)}%</span> → <span className="text-go">{(r.usedBpsAfter / 100).toFixed(1)}%</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 px-3 py-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </div>
  );
}
