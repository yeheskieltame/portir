"use client";

import { useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits, zeroAddress } from "viem";
import { bsc } from "viem/chains";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import type { BuyResponse } from "@/app/api/buy/route";
import { GuardFlow } from "@/app/flow/guard-flow";
import { useIcons } from "@/app/flow/editor";
import { Logo } from "@/app/logo";
import { useMode } from "@/app/mode";
import { usd } from "@/app/verdict";
import { executorAddress } from "@/lib/planRegistry";
import { TESTNET } from "@/lib/testnet";
import {
  COOLDOWN,
  DEFAULT_BUFFER,
  DEFAULT_CAP,
  MAX_PRICE_AGE,
  POOL,
  PROFILES,
  type Profile,
  TICKERS,
  VENUS_MAINNET,
  erc20Abi,
  loanGuardAbi,
  poolAbi,
  symbolAbi,
  tickerOfMarket,
  vTokenAbi,
  venusComptrollerAbi,
  venusOracleAbi,
} from "@/lib/venus";
import { type BatchCall, sendBatch, useBatchSupport } from "@/lib/wallet-batch";

const POLL = 15_000;
const chainId = POOL.chainId;
const E18 = 10n ** 18n;
const usdOf = (v: bigint) => usd.format(Number(formatUnits(v, 18)));
const tusdt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const shares = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 });
const when = (s: number) => new Date(s * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ago = (s: number) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - s) / 60));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const noExecutor = executorAddress === zeroAddress;
const errText = (e: unknown) => (e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e));

type Guard = { executor: `0x${string}`; triggerBps: number; targetBps: number; maxPerRescue: bigint; cooldown: number; lastRescueAt: number; active: boolean };
type RescueRow = { at: number; amount: bigint; usedBpsBefore: number; usedBpsAfter: number };
type Market = readonly [boolean, bigint, bigint, boolean, bigint, number]; // listed, cf, lt, fixedUsd, price, updatedAt

const call = (to: `0x${string}`, data: `0x${string}`, label: string, venus = false): BatchCall => ({ to, data, label, venus });
const approve = (token: `0x${string}`, spender: `0x${string}`, amount: bigint, label: string) => call(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), label);
const setGuardCall = (p: Profile, cap: bigint) =>
  call(POOL.loanGuard, encodeFunctionData({ abi: loanGuardAbi, functionName: "setGuard", args: [executorAddress, POOL.vUSDT, PROFILES[p].trigger, PROFILES[p].target, cap, COOLDOWN] }), "Turn on Loan Guard");
const borrowCall = (amount: bigint, label: string) => call(POOL.vUSDT, encodeFunctionData({ abi: vTokenAbi, functionName: "borrow", args: [amount] }), label, true);
const profileLine = (p: Profile) => `Rescue at ${PROFILES[p].trigger / 100}% of your liquidation limit, back to ${PROFILES[p].target / 100}%.`;
const fresh = (m?: Market) => !!m && m[4] > 0n && Date.now() / 1000 - m[5] <= MAX_PRICE_AGE;

export default function Loans() {
  const { address } = useConnection();
  const mode = useMode();
  return (
    <div className="mx-auto max-w-[720px]">
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em] lg:text-[44px]">
        Borrow against your stocks, <span className="serif-italic text-[1.1em]">without liquidation.</span>
      </h1>
      <p className="mt-3 text-sm text-muted">
        Put the stocks you bought in Portir to work as collateral and borrow USDT. Portir&apos;s agent watches the loan every 5 minutes and repays from your own safety buffer before a price drop gets you close to liquidation. The LoanGuard contract only lets it repay when your position really is past your trigger, at most your cap per rescue.
      </p>
      {mode === "mainnet" && <VenusMainnetCard />}
      {!address ? <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Connect your wallet to borrow against your stocks and turn on the guard.</p> : <Journey owner={address} />}
    </div>
  );
}

function Journey({ owner }: { owner: `0x${string}` }) {
  const icons = useIcons(TICKERS);
  const [ticker, setTicker] = useState("NVDA");
  const vToken = POOL.markets[ticker];
  const stock = TESTNET.stocks[ticker];

  const reads = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: POLL },
    contracts: [
      { address: POOL.loanGuard, abi: loanGuardAbi, functionName: "position", args: [owner], chainId },
      { address: POOL.loanGuard, abi: loanGuardAbi, functionName: "usedBps", args: [owner], chainId },
      { address: POOL.loanGuard, abi: loanGuardAbi, functionName: "guardOf", args: [owner], chainId },
      { address: POOL.loanGuard, abi: loanGuardAbi, functionName: "rescuesOf", args: [owner], chainId },
      { address: POOL.USDT, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId },
      { address: POOL.USDT, abi: erc20Abi, functionName: "allowance", args: [owner, POOL.loanGuard], chainId },
      { address: POOL.pool, abi: poolAbi, functionName: "accountValues", args: [owner], chainId },
      { address: POOL.pool, abi: poolAbi, functionName: "getAssetsIn", args: [owner], chainId },
      { address: POOL.vUSDT, abi: vTokenAbi, functionName: "borrowBalanceStored", args: [owner], chainId },
      { address: stock, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId },
      { address: POOL.pool, abi: poolAbi, functionName: "marketOf", args: [vToken], chainId },
    ],
  });
  const d = reads.data;
  const ok = <T,>(i: number) => (d?.[i]?.status === "success" ? (d[i].result as T) : undefined);
  const pos = ok<readonly [bigint, bigint]>(0);
  const debt = pos?.[0] ?? 0n;
  const liqLimit = pos?.[1] ?? 0n;
  const used = ok<bigint>(1) ?? 0n;
  const guard = ok<Guard>(2);
  const rescues = ok<readonly RescueRow[]>(3) ?? [];
  const usdtBal = ok<bigint>(4) ?? 0n;
  const allowed = ok<bigint>(5) ?? 0n;
  const values = ok<readonly [bigint, bigint, bigint]>(6);
  const borrowLimit = values?.[0] ?? 0n;
  const assetsIn = ok<readonly `0x${string}`[]>(7) ?? [];
  const borrowed = ok<bigint>(8) ?? 0n;
  const stockBal = ok<bigint>(9) ?? 0n;
  const market = ok<Market>(10);

  // Collateral already in the pool: one balance + market read per entered stock market.
  const collateralMarkets = assetsIn.filter((a) => a.toLowerCase() !== POOL.vUSDT.toLowerCase());
  const coll = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: POLL, enabled: collateralMarkets.length > 0 },
    contracts: collateralMarkets.flatMap((v) => [
      { address: v, abi: vTokenAbi, functionName: "balanceOf", args: [owner], chainId } as const,
      { address: POOL.pool, abi: poolAbi, functionName: "marketOf", args: [v], chainId } as const,
    ]),
  });
  const collateral = collateralMarkets
    .map((v, i) => {
      const bal = coll.data?.[2 * i]?.status === "success" ? (coll.data[2 * i].result as bigint) : 0n;
      const m = coll.data?.[2 * i + 1]?.status === "success" ? (coll.data[2 * i + 1].result as Market) : undefined;
      return { vToken: v, ticker: tickerOfMarket(v) ?? "?", bal, m };
    })
    .filter((c) => c.bal > 0n);

  const atomic = useBatchSupport(chainId);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(calls: BatchCall[]) {
    setError(null);
    try {
      await sendBatch(calls, { chainId, account: owner, onProgress: (i, n, label) => setProgress(n > 1 ? `Step ${i} of ${n}: ${label}…` : `${label}…`) });
    } catch (e) {
      setError(errText(e));
    } finally {
      setProgress(null);
      await Promise.all([reads.refetch(), coll.refetch()]);
    }
  }

  if (!pos || !values) return <p className="glass mt-6 rounded-3xl p-5 text-sm text-muted">Reading your stock loan…</p>;

  const active = !!guard?.active;
  const step = debt === 0n && !active ? 1 : !active ? 2 : 3;
  const busy = !!progress;
  const confirms = (n: number) => (atomic ? "1 confirmation in your wallet" : atomic === false ? `${n} confirmations (your wallet does not batch)` : `${n} steps`);
  const lead = collateral[0];

  return (
    <>
      <Progress step={step} />

      {step === 1 && (
        <OpenLoan
          ticker={ticker}
          setTicker={setTicker}
          icons={icons}
          stockBal={stockBal}
          market={market}
          entered={assetsIn.some((a) => a.toLowerCase() === vToken.toLowerCase())}
          borrowLimit={borrowLimit}
          liqLimit={values[1]}
          usdtBal={usdtBal}
          busy={busy}
          confirms={confirms}
          onError={setError}
          onRun={run}
          owner={owner}
        />
      )}

      {step !== 1 && (
        <Health debt={debt} limit={liqLimit} used={used} guard={active ? guard : undefined} borrowed={borrowed} borrowLimit={borrowLimit} collateral={collateral} icons={icons} />
      )}

      {step === 2 && (
        <ProtectLoan
          usdtBal={usdtBal}
          busy={busy}
          confirms={confirms}
          onProtect={(profile, cap, amount) => void run([approve(POOL.USDT, POOL.loanGuard, amount, "Allow the safety buffer"), setGuardCall(profile, cap)])}
          onGetUsdt={() => void run([call(POOL.USDT, encodeFunctionData({ abi: erc20Abi, functionName: "faucet" }), "Get 10,000 test USDT")])}
        />
      )}

      {step === 3 && guard && (
        <Protected
          guard={guard}
          usdtBal={usdtBal}
          allowed={allowed}
          debt={debt}
          busy={busy}
          pricesFresh={collateral.every((c) => fresh(c.m))}
          onTopUp={() => void run([approve(POOL.USDT, POOL.loanGuard, usdtBal > guard.maxPerRescue * 3n ? usdtBal : guard.maxPerRescue * 3n, "Allow the safety buffer")])}
          onBorrowMore={() => {
            const amt = borrowLimit / 10n; // tUSDT is $1: USD 1e18 = token units
            void run([borrowCall(amt, `Borrow ${tusdt(amt)} tUSDT more`)]);
          }}
          onRepay={() => {
            const tenth = borrowLimit / 10n;
            const amt = tenth > borrowed ? borrowed : tenth;
            void run([
              approve(POOL.USDT, POOL.vUSDT, amt, "Allow the repayment"),
              call(POOL.vUSDT, encodeFunctionData({ abi: vTokenAbi, functionName: "repayBorrow", args: [amt] }), `Repay ${tusdt(amt)} tUSDT`, true),
            ]);
          }}
          onTurnOff={() => void run([call(POOL.loanGuard, encodeFunctionData({ abi: loanGuardAbi, functionName: "cancelGuard" }), "Turn off Loan Guard")])}
        />
      )}

      {progress && <p className="mt-4 animate-pulse text-center text-sm text-muted">{progress}</p>}
      {error && <p role="alert" className="mt-4 break-words text-sm text-block">{error}</p>}

      {step === 3 && guard && (
        <section className="mt-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">How your guard works</h2>
          <div className="mt-3">
            <GuardFlow
              triggerPct={guard.triggerBps / 100}
              targetPct={guard.targetBps / 100}
              cap={`${tusdt(guard.maxPerRescue)} tUSDT`}
              collateral={lead ? { ticker: lead.ticker, icon: icons?.[lead.ticker] ?? null } : undefined}
              lastRescue={rescues.length ? { amount: `${tusdt(rescues[rescues.length - 1].amount)} tUSDT`, before: rescues[rescues.length - 1].usedBpsBefore / 100, after: rescues[rescues.length - 1].usedBpsAfter / 100, at: rescues[rescues.length - 1].at } : undefined}
            />
          </div>
        </section>
      )}

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
  ticker: string;
  setTicker: (t: string) => void;
  icons?: Record<string, string | null>;
  stockBal: bigint;
  market?: Market;
  entered: boolean;
  borrowLimit: bigint;
  liqLimit: bigint;
  usdtBal: bigint;
  busy: boolean;
  confirms: (n: number) => string;
  onError: (e: string | null) => void;
  onRun: (calls: BatchCall[]) => Promise<void>;
  owner: `0x${string}`;
}) {
  const vToken = POOL.markets[p.ticker];
  const stock = TESTNET.stocks[p.ticker];
  const own = p.stockBal > 0n;
  const [useOwn, setUseOwn] = useState(true);
  const [ownAmount, setOwnAmount] = useState<string | null>(null);
  const [buyUsd, setBuyUsd] = useState("500");
  const [pct, setPct] = useState(60);
  const [protect, setProtect] = useState(!noExecutor);
  const [profile, setProfile] = useState<Profile>("Balanced");
  const [quoting, setQuoting] = useState(false);

  const price = p.market?.[4] ?? 0n; // USD 1e18 per share
  const cf = p.market?.[1] ?? 0n;
  const lt = p.market?.[2] ?? 0n;
  const priceOk = fresh(p.market);
  const mode: "own" | "buy" = own && useOwn ? "own" : "buy";
  const ownText = ownAmount ?? formatUnits(p.stockBal, 18);
  const ownShares = (() => {
    try {
      const v = parseUnits(ownText || "0", 18);
      return v > p.stockBal ? p.stockBal : v;
    } catch {
      return 0n;
    }
  })();
  const buyWei = Number(buyUsd) >= 1 ? parseUnits(buyUsd, 18) : 0n;
  // Conservative preview of what a buy delivers: 0.1% exchange fee and the quote's 0.5% minimum, at the pool price.
  const estShares = price > 0n ? (((buyWei * 999n) / 1000n) * 995n * E18) / 1000n / price : 0n;
  const newShares = mode === "own" ? ownShares : estShares;
  const addUsd = (newShares * price) / E18;
  const limitAfter = p.borrowLimit + (addUsd * cf) / E18;
  const liqAfter = p.liqLimit + (addUsd * lt) / E18;
  const borrowAmt = (limitAfter * BigInt(pct)) / 100n; // tUSDT, $1
  const healthAfter = liqAfter > 0n ? Number((borrowAmt * 10_000n) / liqAfter) / 100 : 0;
  const needFaucet = mode === "buy" && p.usdtBal < buyWei + (protect ? DEFAULT_BUFFER : 0n);
  const count = (mode === "buy" ? (needFaucet ? 1 : 0) + 2 : 0) + 2 + (p.entered ? 0 : 1) + 1 + (protect && !noExecutor ? 2 : 0);
  const ready = priceOk && newShares > 0n && borrowAmt > 0n && !quoting && !p.busy;

  async function open() {
    p.onError(null);
    const calls: BatchCall[] = [];
    let mintShares = ownShares;
    let borrow = borrowAmt;
    if (mode === "buy") {
      setQuoting(true);
      try {
        const res = await fetch("/api/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: p.ticker, usdt: Number(buyUsd), wallet: p.owner, mode: "testnet" }) });
        const q = (await res.json()) as BuyResponse & { error?: string };
        if (!res.ok || q.error) throw new Error(q.error ?? "Could not get a quote.");
        if (!q.tx || !q.quote) throw new Error(`The Guard says wait: ${q.reason}`);
        mintShares = BigInt(q.quote.minShares); // never more than what the buy delivers
        const add = (mintShares * price) / E18;
        borrow = ((p.borrowLimit + (add * cf) / E18) * BigInt(pct)) / 100n;
        if (needFaucet) calls.push(call(POOL.USDT, encodeFunctionData({ abi: erc20Abi, functionName: "faucet" }), "Get 10,000 test USDT"));
        calls.push(approve(POOL.USDT, TESTNET.exchange, BigInt(q.quote.usdtIn), "Allow the purchase"));
        calls.push(call(q.tx.to as `0x${string}`, q.tx.data as `0x${string}`, `Buy $${buyUsd} of ${p.ticker}`));
      } catch (e) {
        p.onError(errText(e));
        return;
      } finally {
        setQuoting(false);
      }
    }
    calls.push(approve(stock, vToken, mintShares, `Allow ${p.ticker} as collateral`));
    calls.push(call(vToken, encodeFunctionData({ abi: vTokenAbi, functionName: "mint", args: [mintShares] }), `Supply ${shares(mintShares)} ${p.ticker}`, true));
    if (!p.entered) calls.push(call(POOL.pool, encodeFunctionData({ abi: poolAbi, functionName: "enterMarkets", args: [[vToken]] }), `Use ${p.ticker} as collateral`));
    calls.push(borrowCall(borrow, `Borrow ${tusdt(borrow)} tUSDT`));
    if (protect && !noExecutor) calls.push(approve(POOL.USDT, POOL.loanGuard, DEFAULT_BUFFER, "Allow the safety buffer"), setGuardCall(profile, DEFAULT_CAP));
    await p.onRun(calls);
  }

  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <h2 className="text-xl">Borrow against your stocks</h2>
      <p className="mt-1 text-sm text-muted">Your stock goes into Portir&apos;s test lending pool as collateral and you borrow tUSDT against it. Same rules as Venus&apos; stock markets: borrow up to 60% of the value, liquidation at 70%.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {TICKERS.map((t) => (
          <button key={t} onClick={() => p.setTicker(t)} className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 font-mono text-xs ${t === p.ticker ? "border-white/60 bg-white/15 text-white" : "border-line text-muted"}`}>
            <Logo src={p.icons?.[t] ?? null} name={t} size={20} />
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">
          You hold <b className="text-white">{shares(p.stockBal)} {p.ticker}</b>
        </span>
        <span className="font-mono tabular-nums">
          {priceOk ? (
            <>
              {usdOf(price)} <span className="text-muted">· price {ago(p.market![5])} · agent feed</span>
            </>
          ) : (
            <span className="text-warn">Waiting for the agent&apos;s price feed</span>
          )}
        </span>
      </div>

      {own && (
        <div className="glass mt-3 grid grid-cols-2 rounded-full p-1 text-xs font-medium">
          <button onClick={() => setUseOwn(true)} className={`rounded-full py-1.5 ${useOwn ? "bg-white text-black" : "text-muted"}`}>Use stock I own</button>
          <button onClick={() => setUseOwn(false)} className={`rounded-full py-1.5 ${!useOwn ? "bg-white text-black" : "text-muted"}`}>Buy more first</button>
        </div>
      )}

      {mode === "own" ? (
        <label className="mt-3 block text-xs text-muted">
          Shares to supply
          <input inputMode="decimal" value={ownText} onChange={(e) => setOwnAmount(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
          <span className="mt-1 block">≈ {usdOf(addUsd)} of collateral</span>
        </label>
      ) : (
        <label className="mt-3 block text-xs text-muted">
          Buy {p.ticker} first (tUSDT)
          <input inputMode="decimal" value={buyUsd} onChange={(e) => setBuyUsd(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
          <span className="mt-1 block">≈ {shares(estShares)} {p.ticker} at the live price, bought through Portir&apos;s Guard{needFaucet ? " · includes 10,000 free test USDT" : ""}</span>
        </label>
      )}

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Borrow</span>
          <span className="font-mono tabular-nums">
            {tusdt(borrowAmt)} tUSDT <span className="text-muted">· {usdOf(borrowAmt)}</span>
          </span>
        </div>
        <input type="range" min={10} max={90} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="mt-2 w-full accent-brand" aria-label="Share of the borrow limit" />
        <p className="text-xs text-muted">
          {pct}% of your borrow limit ({usdOf(limitAfter)}) · uses <b className={healthAfter >= 80 ? "text-warn" : "text-white"}>{healthAfter.toFixed(1)}%</b> of the liquidation limit ({usdOf(liqAfter)}). Liquidation at 100%.
        </p>
      </div>

      <label className={`mt-5 flex items-start gap-3 rounded-2xl border border-line p-3 text-sm ${noExecutor ? "opacity-60" : ""}`}>
        <input type="checkbox" checked={protect} disabled={noExecutor} onChange={(e) => setProtect(e.target.checked)} className="mt-1 accent-brand" />
        <span className="min-w-0 flex-1">
          Protect it with Loan Guard
          <span className="block text-xs text-muted">If {p.ticker} drops, the agent repays up to 200 tUSDT at a time from a 500 tUSDT buffer in your wallet.</span>
          {protect && <ProfilePicker value={profile} onChange={setProfile} />}
        </span>
      </label>
      {noExecutor && <p className="mt-2 text-xs text-warn">The executor agent is not configured (NEXT_PUBLIC_EXECUTOR), so the guard cannot be turned on.</p>}

      <button disabled={!ready} onClick={() => void open()} className="mt-5 w-full rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-50">
        {quoting ? "Getting a fair price…" : p.busy ? "Working…" : protect ? "Open protected loan" : "Open loan"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">{priceOk ? p.confirms(count) : "Borrowing opens once the agent has pushed a fresh price (it does every 5 minutes)."}</p>
    </section>
  );
}

function Health({
  debt,
  limit,
  used,
  guard,
  borrowed,
  borrowLimit,
  collateral,
  icons,
}: {
  debt: bigint;
  limit: bigint;
  used: bigint;
  guard?: Guard;
  borrowed: bigint;
  borrowLimit: bigint;
  collateral: { ticker: string; bal: bigint; m?: Market }[];
  icons?: Record<string, string | null>;
}) {
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
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Your stock loan · BSC testnet</h2>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
      </div>
      {collateral.length > 0 && (
        <ul className="mt-4 space-y-2">
          {collateral.map((c) => (
            <li key={c.ticker} className="flex items-center gap-3 text-sm">
              <Logo src={icons?.[c.ticker] ?? null} name={c.ticker} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono">
                  {shares(c.bal)} {c.ticker}
                </span>
                <span className="block text-xs text-muted">{c.m && c.m[4] > 0n ? `${usdOf(c.m[4])} · price ${ago(c.m[5])} · agent feed${fresh(c.m) ? "" : " (stale)"}` : "Waiting for the agent's price feed"}</span>
              </span>
              <span className="font-mono tabular-nums">{c.m ? usdOf((c.bal * c.m[4]) / E18) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <dt className="text-xs text-muted">Debt</dt>
          <dd className="mt-1 font-mono text-xl tabular-nums">{usdOf(debt)}</dd>
          <dd className="text-xs text-muted">{tusdt(borrowed)} tUSDT</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Borrow limit</dt>
          <dd className="mt-1 font-mono text-xl tabular-nums">{usdOf(borrowLimit)}</dd>
          <dd className="text-xs text-muted">60% of collateral</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Liquidation limit</dt>
          <dd className="mt-1 font-mono text-xl tabular-nums">{usdOf(limit)}</dd>
          <dd className="text-xs text-muted">70% of collateral</dd>
        </div>
      </dl>
      <div className="mt-6">
        <div className="flex justify-between text-xs text-muted">
          <span>Liquidation limit used</span>
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
      <p className="mt-3 text-xs text-muted">Stock prices come from the agent&apos;s live feed into the pool&apos;s oracle, the same one that decides liquidations.</p>
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

function ProtectLoan(p: { usdtBal: bigint; busy: boolean; confirms: (n: number) => string; onProtect: (profile: Profile, cap: bigint, amount: bigint) => void; onGetUsdt: () => void }) {
  const [profile, setProfile] = useState<Profile>("Balanced");
  const [cap, setCap] = useState("200");
  const defaultBuffer = p.usdtBal > DEFAULT_BUFFER ? DEFAULT_BUFFER : p.usdtBal;
  const [amount, setAmount] = useState<string | null>(null);
  const bufferText = amount ?? formatUnits(defaultBuffer, 18);
  const capUnits = Number(cap) > 0 ? parseUnits(cap, 18) : 0n;
  const bufferUnits = Number(bufferText) > 0 ? parseUnits(bufferText, 18) : 0n;
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <h2 className="text-xl">Protect this loan</h2>
      <p className="mt-1 text-sm text-muted">Choose how close to liquidation you are willing to get if your stocks fall. The agent repays from a tUSDT buffer in your wallet; the money goes straight to the pool.</p>
      <div className="mt-4">
        <span className="text-xs text-muted">Profile</span>
        <ProfilePicker value={profile} onChange={setProfile} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          At most per rescue (tUSDT)
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
        </label>
        <label className="block text-xs text-muted">
          Safety buffer (tUSDT)
          <input inputMode="decimal" value={bufferText} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="field" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        You have {tusdt(p.usdtBal)} tUSDT.{" "}
        {p.usdtBal === 0n && (
          <button disabled={p.busy} onClick={p.onGetUsdt} className="underline disabled:opacity-50">
            Get 10,000 test USDT
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

function Protected(p: {
  guard: Guard;
  usdtBal: bigint;
  allowed: bigint;
  debt: bigint;
  busy: boolean;
  pricesFresh: boolean;
  onTopUp: () => void;
  onBorrowMore: () => void;
  onRepay: () => void;
  onTurnOff: () => void;
}) {
  const low = p.allowed < p.guard.maxPerRescue;
  const name = (Object.keys(PROFILES) as Profile[]).find((k) => PROFILES[k].trigger === p.guard.triggerBps && PROFILES[k].target === p.guard.targetBps) ?? "Custom";
  return (
    <section className="glass mt-4 rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl">Loan Guard is on</h2>
        <span className="rounded-full border border-go/40 bg-go/10 px-2.5 py-1 text-xs font-medium text-go">Protected</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {name}: rescue at {p.guard.triggerBps / 100}%, back to {p.guard.targetBps / 100}% · up to {tusdt(p.guard.maxPerRescue)} tUSDT per rescue · every {Math.round(p.guard.cooldown / 60)} min at most.
      </p>
      <p className="mt-1 text-sm text-muted">
        Buffer the agent may use: <b className="text-white">{tusdt(p.allowed)} tUSDT</b> (you hold {tusdt(p.usdtBal)}).{" "}
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
        <p className="mt-2 text-xs text-muted">Borrow more to push your loan past the trigger, as a price drop would. The agent checks every 5 minutes and repays from your buffer.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={p.busy || !p.pricesFresh} onClick={p.onBorrowMore} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            Borrow 10% more
          </button>
          <button disabled={p.busy || p.debt === 0n} onClick={p.onRepay} className="glass rounded-full px-3 py-1.5 text-xs disabled:opacity-50">
            Repay 10%
          </button>
        </div>
        {!p.pricesFresh && <p className="mt-2 text-xs text-warn">Borrowing waits for a fresh price from the agent (at most 1 hour old).</p>}
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
                <span className="block font-mono tabular-nums">{tusdt(r.amount)} tUSDT</span>
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

/** Mainnet: the same guard maps onto Venus' real tokenized-stock markets. Read live, nothing to sign. */
function VenusMainnetCard() {
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: VENUS_MAINNET.vTSLAB, abi: symbolAbi, functionName: "symbol", chainId: bsc.id },
      { address: VENUS_MAINNET.comptroller, abi: venusComptrollerAbi, functionName: "markets", args: [VENUS_MAINNET.vTSLAB], chainId: bsc.id },
      { address: VENUS_MAINNET.comptroller, abi: venusComptrollerAbi, functionName: "oracle", chainId: bsc.id },
    ],
  });
  const symbol = reads.data?.[0]?.status === "success" ? (reads.data[0].result as string) : "vTSLAB";
  const m = reads.data?.[1]?.status === "success" ? (reads.data[1].result as readonly [boolean, bigint, boolean, bigint]) : undefined;
  const oracle = reads.data?.[2]?.status === "success" ? (reads.data[2].result as `0x${string}`) : undefined;
  const price = useReadContract({ address: oracle, abi: venusOracleAbi, functionName: "getUnderlyingPrice", args: [VENUS_MAINNET.vTSLAB], chainId: bsc.id, query: { enabled: !!oracle } }).data;
  return (
    <section className="glass mt-4 rounded-3xl p-4 text-sm">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">On mainnet: Venus lists tokenized stocks</p>
      <div className="mt-3 flex items-center gap-3">
        <Logo src="/logos/venus.png" name="Venus" size={32} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{symbol} · Tesla (bStocks TSLAB)</span>
          <span className="block text-xs text-muted">
            Collateral factor {m ? `${Number(formatUnits(m[1], 16)).toFixed(0)}%` : "—"} · liquidation at {m ? `${Number(formatUnits(m[3], 16)).toFixed(0)}%` : "—"}
          </span>
        </span>
        <span className="font-mono tabular-nums">{price !== undefined ? usdOf(price) : "—"}</span>
      </div>
      <p className="mt-3 text-xs text-muted">Live from the Venus core pool on BNB Chain. Same LoanGuard contract, next step; this page runs on BSC testnet with Portir&apos;s stock pool meanwhile.</p>
    </section>
  );
}
