"use client";

import { useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits, zeroAddress } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { readContract } from "wagmi/actions";
import { useMode } from "@/app/mode";
import { usd } from "@/app/verdict";
import { executorAddress } from "@/lib/planRegistry";
import {
  COOLDOWN,
  PROFILES,
  type Profile,
  TEST_BUFFER,
  TEST_CAKE,
  USDT_DEC,
  VENUS,
  comptrollerAbi,
  faucetTokenAbi,
  loanGuardAbi,
  oracleAbi,
  starterAbi,
  vTokenAbi,
} from "@/lib/venus";
import { type BatchCall, sendBatch, useBatchSupport } from "@/lib/wallet-batch";
import { config } from "@/lib/wagmi";

const POLL = 15_000;
const chainId = VENUS.chainId;
const usdOf = (v: bigint) => usd.format(Number(formatUnits(v, 18)));
const usdt = (v: bigint) => Number(formatUnits(v, USDT_DEC)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const when = (s: number) => new Date(s * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const noExecutor = executorAddress === zeroAddress;

type Guard = { executor: `0x${string}`; triggerBps: number; targetBps: number; maxPerRescue: bigint; cooldown: number; lastRescueAt: number; active: boolean };
type RescueRow = { at: number; amount: bigint; usedBpsBefore: number; usedBpsAfter: number };

const call = (to: `0x${string}`, data: `0x${string}`, label: string, venus = false): BatchCall => ({ to, data, label, venus });
const approveBuffer = (amount: bigint) => call(VENUS.USDT, encodeFunctionData({ abi: faucetTokenAbi, functionName: "approve", args: [VENUS.loanGuard, amount] }), "Allow the safety buffer");
const setGuard = (p: Profile, cap: bigint) =>
  call(VENUS.loanGuard, encodeFunctionData({ abi: loanGuardAbi, functionName: "setGuard", args: [executorAddress, VENUS.vUSDT, PROFILES[p].trigger, PROFILES[p].target, cap, COOLDOWN] }), "Turn on Loan Guard");
const profileLine = (p: Profile) => `Rescue at ${PROFILES[p].trigger / 100}% of your liquidation limit, back to ${PROFILES[p].target / 100}%.`;

export default function Loans() {
  const { address } = useConnection();
  const mode = useMode();
  return (
    <div className="mx-auto max-w-[720px]">
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em] lg:text-[44px]">
        Borrow against it, <span className="serif-italic text-[1.1em]">without liquidation.</span>
      </h1>
      <p className="mt-3 text-sm text-muted">
        Portir&apos;s agent watches your Venus loan every 5 minutes and repays from your own safety buffer before you get close to liquidation. The LoanGuard contract only lets it repay when your position really is past your trigger, at most your cap per rescue.
      </p>
      {mode === "mainnet" && (
        <p className="mt-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-xs text-warn">
          Loan Guard runs on BSC testnet for now. Venus lists tokenized stocks like NVDAB on mainnet; it is the same contract, and the next step.
        </p>
      )}
      {!address ? <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Connect your wallet to open a loan and turn on the guard.</p> : <Journey owner={address} />}
    </div>
  );
}

function Journey({ owner }: { owner: `0x${string}` }) {
  const reads = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: POLL },
    contracts: [
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "position", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "usedBps", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "guardOf", args: [owner], chainId },
      { address: VENUS.loanGuard, abi: loanGuardAbi, functionName: "rescuesOf", args: [owner], chainId },
      { address: VENUS.USDT, abi: faucetTokenAbi, functionName: "balanceOf", args: [owner], chainId },
      { address: VENUS.USDT, abi: faucetTokenAbi, functionName: "allowance", args: [owner, VENUS.loanGuard], chainId },
      { address: VENUS.vCAKE, abi: vTokenAbi, functionName: "balanceOf", args: [owner], chainId },
      { address: VENUS.comptroller, abi: comptrollerAbi, functionName: "getAssetsIn", args: [owner], chainId },
      { address: VENUS.vUSDT, abi: vTokenAbi, functionName: "borrowBalanceStored", args: [owner], chainId },
      { address: VENUS.oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [VENUS.vUSDT], chainId },
      { address: VENUS.oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [VENUS.vCAKE], chainId },
      { address: VENUS.comptroller, abi: comptrollerAbi, functionName: "markets", args: [VENUS.vCAKE], chainId },
    ],
  });
  const d = reads.data;
  const ok = <T,>(i: number) => (d?.[i]?.status === "success" ? (d[i].result as T) : undefined);
  const pos = ok<readonly [bigint, bigint]>(0);
  const debt = pos?.[0] ?? 0n;
  const limit = pos?.[1] ?? 0n;
  const used = ok<bigint>(1) ?? 0n;
  const guard = ok<Guard>(2);
  const rescues = ok<readonly RescueRow[]>(3) ?? [];
  const buffer = ok<bigint>(4) ?? 0n;
  const allowed = ok<bigint>(5) ?? 0n;
  const vCake = ok<bigint>(6) ?? 0n;
  const entered = (ok<readonly `0x${string}`[]>(7) ?? []).some((a) => a.toLowerCase() === VENUS.vCAKE.toLowerCase());
  const borrowed = ok<bigint>(8) ?? 0n;
  const usdtPrice = ok<bigint>(9) ?? 0n;
  const cakePrice = ok<bigint>(10) ?? 0n;
  const cakeLt = ok<readonly [boolean, bigint, boolean, bigint]>(11)?.[3] ?? 0n;
  const atomic = useBatchSupport(chainId);

  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** USDT (6 dec) worth `usd18` at the Venus oracle price (scaled 1e30 for a 6-decimal token). */
  const usdtFor = (usd18: bigint) => (usdtPrice > 0n ? (usd18 * 10n ** 18n) / usdtPrice : 0n);

  async function run(calls: BatchCall[], expectBorrow?: bigint) {
    setError(null);
    const before = borrowed;
    try {
      await sendBatch(calls, { chainId, account: owner, onProgress: (i, n, label) => setProgress(n > 1 ? `Step ${i} of ${n}: ${label}…` : `${label}…`) });
      if (expectBorrow) {
        // vTokens report a refused borrow as an error code, not a revert: check the debt actually moved.
        const now = await readContract(config, { chainId, address: VENUS.vUSDT, abi: vTokenAbi, functionName: "borrowBalanceStored", args: [owner] });
        if (now <= before) setError("Venus did not lend: the borrow was refused (for example above your borrow limit). Try a smaller share.");
      }
    } catch (e) {
      setError(e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      await reads.refetch();
    }
  }

  if (!pos) return <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Reading your Venus position…</p>;

  const active = !!guard?.active;
  const step = debt === 0n && !active ? 1 : !active ? 2 : 3;
  const busy = !!progress;
  const confirms = (n: number) => (atomic ? "1 confirmation in your wallet" : atomic === false ? `${n} confirmations (your wallet does not batch)` : `${n} steps`);

  return (
    <>
      <Progress step={step} />

      {step === 1 && (
        <OpenLoan
          supplied={vCake > 0n && entered}
          limitNow={limit}
          limitNew={cakePrice > 0n && cakeLt > 0n ? (((TEST_CAKE * cakePrice) / 10n ** 18n) * cakeLt) / 10n ** 18n : 0n}
          usdtFor={usdtFor}
          busy={busy}
          confirms={confirms}
          onOpen={(pct, protect, profile) => {
            const supplied = vCake > 0n && entered;
            const collateralLimit = supplied ? limit : (((TEST_CAKE * cakePrice) / 10n ** 18n) * cakeLt) / 10n ** 18n;
            const amount = usdtFor((collateralLimit * BigInt(pct)) / 100n);
            const calls: BatchCall[] = [];
            if (!supplied) {
              calls.push(call(VENUS.starter, encodeFunctionData({ abi: starterAbi, functionName: "open", args: [TEST_CAKE, TEST_BUFFER] }), "Supply 1,000 test CAKE and get a 500 USDT buffer"));
              calls.push(call(VENUS.comptroller, encodeFunctionData({ abi: comptrollerAbi, functionName: "enterMarkets", args: [[VENUS.vCAKE]] }), "Use CAKE as collateral"));
            }
            calls.push(call(VENUS.vUSDT, encodeFunctionData({ abi: vTokenAbi, functionName: "borrow", args: [amount] }), `Borrow ${usdt(amount)} USDT`, true));
            if (protect && !noExecutor) calls.push(approveBuffer(TEST_BUFFER), setGuard(profile, parseUnits("200", USDT_DEC)));
            void run(calls, amount);
          }}
        />
      )}

      {step !== 1 && <Health debt={debt} limit={limit} used={used} guard={active ? guard : undefined} borrowed={borrowed} />}

      {step === 2 && (
        <ProtectLoan
          buffer={buffer}
          busy={busy}
          confirms={confirms}
          onProtect={(profile, cap, amount) => void run([approveBuffer(amount), setGuard(profile, cap)])}
          onGetUsdt={() => void run([call(VENUS.starter, encodeFunctionData({ abi: starterAbi, functionName: "open", args: [0n, TEST_BUFFER] }), "Get 500 test USDT")])}
        />
      )}

      {step === 3 && guard && (
        <Protected
          guard={guard}
          buffer={buffer}
          allowed={allowed}
          debt={debt}
          busy={busy}
          onTopUp={() => void run([approveBuffer(buffer > guard.maxPerRescue * 3n ? buffer : guard.maxPerRescue * 3n)])}
          onBorrowMore={() => {
            const amt = usdtFor(limit / 10n);
            void run([call(VENUS.vUSDT, encodeFunctionData({ abi: vTokenAbi, functionName: "borrow", args: [amt] }), `Borrow ${usdt(amt)} USDT more`, true)], amt);
          }}
          onRepay={() => {
            const tenth = usdtFor(limit / 10n);
            const amt = tenth > borrowed ? borrowed : tenth;
            void run([
              call(VENUS.USDT, encodeFunctionData({ abi: faucetTokenAbi, functionName: "approve", args: [VENUS.vUSDT, amt] }), "Allow the repayment"),
              call(VENUS.vUSDT, encodeFunctionData({ abi: vTokenAbi, functionName: "repayBorrow", args: [amt] }), `Repay ${usdt(amt)} USDT`, true),
            ]);
          }}
          onTurnOff={() => void run([call(VENUS.loanGuard, encodeFunctionData({ abi: loanGuardAbi, functionName: "cancelGuard" }), "Turn off Loan Guard")])}
        />
      )}

      {progress && <p className="mt-4 animate-pulse text-center text-sm text-muted">{progress}</p>}
      {error && <p role="alert" className="mt-4 break-words text-sm text-block">{error}</p>}

      {step === 3 && <History rescues={rescues} />}
    </>
  );
}

function Progress({ step }: { step: number }) {
  const steps = ["Open a loan", "Turn on Loan Guard", "Protected"];
  return (
    <ol className="mt-6 flex items-center gap-2 text-xs">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "now" : "next";
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <span className={`grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] ${state === "done" ? "border-go/50 bg-go/10 text-go" : state === "now" ? "border-white bg-white text-black" : "border-line text-muted"}`}>
              {state === "done" ? "✓" : n}
            </span>
            <span className={`truncate ${state === "now" ? "text-white" : "text-muted"}`}>{s}</span>
            {n < steps.length && <span aria-hidden className="h-px min-w-3 flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}

function ProfilePicker({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {(Object.keys(PROFILES) as Profile[]).map((k) => (
          <button key={k} onClick={() => onChange(k)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${k === value ? "border-white/60 bg-white/15 text-white" : "border-line text-muted"}`}>
            {k}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{profileLine(value)}</p>
    </>
  );
}

function OpenLoan(p: {
  supplied: boolean;
  limitNow: bigint;
  limitNew: bigint;
  usdtFor: (usd18: bigint) => bigint;
  busy: boolean;
  confirms: (n: number) => string;
  onOpen: (pct: number, protect: boolean, profile: Profile) => void;
}) {
  const [pct, setPct] = useState(70);
  const [protect, setProtect] = useState(!noExecutor);
  const [profile, setProfile] = useState<Profile>("Balanced");
  const limit = p.supplied ? p.limitNow : p.limitNew;
  const usd18 = (limit * BigInt(pct)) / 100n;
  const calls = (p.supplied ? 1 : 3) + (protect ? 2 : 0);
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <h2 className="text-xl">Open a test loan</h2>
      <p className="mt-1 text-sm text-muted">
        {p.supplied ? "Your CAKE is already supplied. Pick how much to borrow." : "1,000 test CAKE go into Venus as collateral and you borrow USDT against them. Free on BSC testnet."}
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Borrow</span>
          <span className="font-mono tabular-nums">
            {usdt(p.usdtFor(usd18))} USDT <span className="text-muted">· {usdOf(usd18)}</span>
          </span>
        </div>
        <input type="range" min={10} max={75} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="mt-2 w-full accent-brand" aria-label="Share of the liquidation limit" />
        <p className="text-xs text-muted">
          {pct}% of your liquidation limit ({usdOf(limit)}). Venus liquidates at 100%.
        </p>
      </div>

      <label className={`mt-5 flex items-start gap-3 rounded-2xl border border-line p-3 text-sm ${noExecutor ? "opacity-60" : ""}`}>
        <input type="checkbox" checked={protect} disabled={noExecutor} onChange={(e) => setProtect(e.target.checked)} className="mt-1 accent-brand" />
        <span className="min-w-0 flex-1">
          Protect it with Loan Guard
          <span className="block text-xs text-muted">The agent repays up to 200 USDT at a time from a 500 USDT buffer when you get too close.</span>
          {protect && <ProfilePicker value={profile} onChange={setProfile} />}
        </span>
      </label>
      {noExecutor && <p className="mt-2 text-xs text-warn">The executor agent is not configured (NEXT_PUBLIC_EXECUTOR), so the guard cannot be turned on.</p>}

      <button disabled={p.busy || limit === 0n} onClick={() => p.onOpen(pct, protect, profile)} className="mt-5 w-full rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-50">
        {p.busy ? "Working…" : protect ? "Open protected loan" : "Open loan"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">{p.confirms(calls)}</p>
    </section>
  );
}

function Health({ debt, limit, used, guard, borrowed }: { debt: bigint; limit: bigint; used: bigint; guard?: Guard; borrowed: bigint }) {
  const trigger = guard?.triggerBps ?? PROFILES.Balanced.trigger;
  const target = guard?.targetBps ?? PROFILES.Balanced.target;
  const pct = used >= 10_000n ? 100 : Number(used) / 100;
  const status =
    debt === 0n ? { label: "No debt", cls: "text-muted border-line", bar: "bg-go" }
    : used >= 10_000n ? { label: "Liquidatable", cls: "text-block border-block/40 bg-block/10", bar: "bg-block" }
    : used >= BigInt(trigger) ? { label: "At risk", cls: "text-block border-block/40 bg-block/10", bar: "bg-block" }
    : used >= BigInt(target) ? { label: "Careful", cls: "text-warn border-warn/40 bg-warn/10", bar: "bg-warn" }
    : { label: "Safe", cls: "text-go border-go/40 bg-go/10", bar: "bg-go" };
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Your Venus loan · BSC testnet</h2>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted">Debt</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums">{usdOf(debt)}</dd>
          <dd className="text-xs text-muted">{usdt(borrowed)} USDT</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Liquidation limit</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums">{usdOf(limit)}</dd>
        </div>
      </dl>
      <div className="mt-6">
        <div className="flex justify-between text-xs text-muted">
          <span>Limit used</span>
          <span className="font-mono tabular-nums text-white">{debt > 0n ? `${pct.toFixed(1)}%` : "—"}</span>
        </div>
        <div className="relative mt-2 h-3 rounded-full bg-white/10">
          <div className={`h-full rounded-full ${status.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          {guard && (
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
      <p className="mt-3 text-xs text-muted">Prices come from the Venus oracle, the same one that decides liquidations.</p>
    </section>
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

function ProtectLoan(p: { buffer: bigint; busy: boolean; confirms: (n: number) => string; onProtect: (profile: Profile, cap: bigint, amount: bigint) => void; onGetUsdt: () => void }) {
  const [profile, setProfile] = useState<Profile>("Balanced");
  const [cap, setCap] = useState("200");
  const defaultBuffer = p.buffer > TEST_BUFFER ? TEST_BUFFER : p.buffer;
  const [amount, setAmount] = useState<string | null>(null);
  const bufferText = amount ?? formatUnits(defaultBuffer, USDT_DEC);
  const capUnits = Number(cap) > 0 ? parseUnits(cap, USDT_DEC) : 0n;
  const bufferUnits = Number(bufferText) > 0 ? parseUnits(bufferText, USDT_DEC) : 0n;
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <h2 className="text-xl">Protect this loan</h2>
      <p className="mt-1 text-sm text-muted">Choose how close to liquidation you are willing to get. The agent repays from a USDT buffer in your wallet; the money goes straight to Venus.</p>
      <div className="mt-4">
        <span className="text-xs text-muted">Profile</span>
        <ProfilePicker value={profile} onChange={setProfile} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          At most per rescue (USDT)
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
        </label>
        <label className="block text-xs text-muted">
          Safety buffer (USDT)
          <input inputMode="decimal" value={bufferText} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        You have {usdt(p.buffer)} USDT.{" "}
        {p.buffer === 0n && (
          <button disabled={p.busy} onClick={p.onGetUsdt} className="underline disabled:opacity-50">
            Get 500 test USDT
          </button>
        )}
      </p>
      <button disabled={p.busy || noExecutor || capUnits === 0n || bufferUnits === 0n} onClick={() => p.onProtect(profile, capUnits, bufferUnits)} className="mt-5 w-full rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-50">
        {p.busy ? "Working…" : "Turn on Loan Guard"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">{p.confirms(2)}</p>
      {noExecutor && <p className="mt-2 text-xs text-warn">The executor agent is not configured (NEXT_PUBLIC_EXECUTOR).</p>}
    </section>
  );
}

function Protected(p: { guard: Guard; buffer: bigint; allowed: bigint; debt: bigint; busy: boolean; onTopUp: () => void; onBorrowMore: () => void; onRepay: () => void; onTurnOff: () => void }) {
  const low = p.allowed < p.guard.maxPerRescue;
  const name = (Object.keys(PROFILES) as Profile[]).find((k) => PROFILES[k].trigger === p.guard.triggerBps && PROFILES[k].target === p.guard.targetBps) ?? "Custom";
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl">Loan Guard is on</h2>
        <span className="rounded-full border border-go/40 bg-go/10 px-2.5 py-1 text-xs font-medium text-go">Protected</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {name}: rescue at {p.guard.triggerBps / 100}%, back to {p.guard.targetBps / 100}% · up to {usdt(p.guard.maxPerRescue)} USDT per rescue · every {Math.round(p.guard.cooldown / 60)} min at most.
      </p>
      <p className="mt-1 text-sm text-muted">
        Buffer the agent may use: <b className="text-white">{usdt(p.allowed)} USDT</b> (you hold {usdt(p.buffer)}).{" "}
        {!low && (
          <button disabled={p.busy} onClick={p.onTopUp} className="underline disabled:opacity-50">
            Top up
          </button>
        )}
      </p>
      {low && (
        <>
          <p className="mt-3 text-xs text-warn">The buffer allowance is below one rescue; the agent would have nothing to repay with.</p>
          <button disabled={p.busy} onClick={p.onTopUp} className="mt-3 w-full rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-50">
            {p.busy ? "Working…" : "Top up buffer"}
          </button>
        </>
      )}

      <details className="mt-4 rounded-2xl border border-line p-3 text-sm">
        <summary className="cursor-pointer text-muted">Try it</summary>
        <p className="mt-2 text-xs text-muted">Borrow more to push your loan past the trigger. The agent checks every 5 minutes and repays from your buffer.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={p.busy} onClick={p.onBorrowMore} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            Borrow 10% more
          </button>
          <button disabled={p.busy || p.debt === 0n} onClick={p.onRepay} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            Repay 10%
          </button>
        </div>
      </details>

      <button disabled={p.busy} onClick={p.onTurnOff} className="mt-4 text-xs text-muted underline disabled:opacity-50">
        Turn off guard
      </button>
    </section>
  );
}

function History({ rescues }: { rescues: readonly RescueRow[] }) {
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
