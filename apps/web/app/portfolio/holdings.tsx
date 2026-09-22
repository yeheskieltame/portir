"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { Logo } from "@/app/logo";
import { pct, usd } from "@/app/verdict";
import { useBuys } from "@/lib/buys";
import type { Quoted, Range } from "@/lib/live";
import { AllocationPie, type ChartType, type Point, ValueChart } from "./charts";

export interface Token {
  ticker: string;
  address: `0x${string}`;
  multiplier: number;
}
interface Holding extends Quoted {
  ticker: string;
  shares: number;
  /** USD paid; only the sample preview knows it until the buy flow records purchases. */
  cost?: number;
}

const RANGES: Range[] = ["1D", "1W", "1M", "1Y"];
const POLL = 30_000;
// Demo holdings so the screen can be judged before the first mainnet buy.
const SAMPLE: Record<string, { shares: number; cost: number }> = { NVDA: { shares: 0.42, cost: 78.5 }, AAPL: { shares: 1.2, cost: 276 }, SPY: { shares: 0.3, cost: 195 } };

export function Holdings({ tokens, chainId, initialPreview = false }: { tokens: Token[]; chainId: 56 | 97; initialPreview?: boolean }) {
  const { address } = useConnection();
  const [preview, setPreview] = useState(initialPreview);
  const [range, setRange] = useState<Range>("1W");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [q, setQ] = useState("");
  const buys = useBuys();
  const paid = (ticker: string) => buys.filter((b) => b.ticker === ticker).reduce((n, b) => n + b.usdt, 0) || undefined;

  const balances = useReadContracts({
    contracts: tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const, chainId })),
    allowFailure: true,
    query: { enabled: !!address && tokens.length > 0, refetchInterval: POLL },
  });
  // Raw token units per contract, only where the wallet holds something.
  const raw = useMemo(() => {
    const out: Record<string, { ticker: string; units: number; multiplier: number }> = {};
    balances.data?.forEach((r, i) => {
      if (r.status === "success" && (r.result as bigint) > BigInt(0)) out[tokens[i].address.toLowerCase()] = { ticker: tokens[i].ticker, units: Number(formatUnits(r.result as bigint, 18)), multiplier: tokens[i].multiplier };
    });
    return out;
  }, [balances.data, tokens]);

  const tickers = preview ? Object.keys(SAMPLE) : [...new Set(Object.values(raw).map((r) => r.ticker))].sort();
  const quotes = useQuery({
    queryKey: ["quote", tickers, range],
    queryFn: () => fetch(`/api/quote?tickers=${tickers.join(",")}&range=${range}`).then((r) => r.json() as Promise<Record<string, Quoted>>),
    enabled: tickers.length > 0,
    refetchInterval: POLL,
  });

  const holdings: Holding[] = useMemo(() => {
    const data = quotes.data ?? {};
    return tickers.flatMap((ticker) => {
      const qd = data[ticker];
      if (!qd) return [];
      const shares = preview
        ? SAMPLE[ticker].shares
        : Object.entries(raw).filter(([, r]) => r.ticker === ticker).reduce((n, [addr, r]) => n + r.units * (qd.multipliers[addr] ?? r.multiplier), 0);
      return shares > 0 ? [{ ...qd, ticker, shares, cost: preview ? SAMPLE[ticker].cost : paid(ticker) }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes.data, tickers, raw, preview, buys]);

  const value = holdings.reduce((sum, h) => sum + h.shares * h.onchain, 0);
  // Portfolio history: each holding's per-share series × its shares, summed at matching candles from the end.
  const series = useMemo((): Point[] => {
    const n = Math.min(...holdings.map((h) => h.series.length));
    if (!holdings.length || !Number.isFinite(n) || n < 2) return [];
    const at = (h: Holding, i: number) => h.series[h.series.length - n + i];
    return Array.from({ length: n }, (_, i) => ({ t: at(holdings[0], i)[0], v: holdings.reduce((sum, h) => sum + h.shares * at(h, i)[1], 0) }));
  }, [holdings]);
  // All-time P&L only when every holding has a recorded purchase; otherwise the change over the chosen range.
  const cost = holdings.length > 0 && holdings.every((h) => h.cost != null) ? holdings.reduce((sum, h) => sum + h.cost!, 0) : null;
  const delta = cost !== null ? value - cost : series.length ? value - series[0].v : 0;
  const base = cost !== null ? cost : series[0]?.v || value;
  const up = delta >= 0;

  const shown = holdings.filter((h) => !q || h.ticker.includes(q.toUpperCase()) || h.name.toUpperCase().includes(q.toUpperCase()));
  const empty = holdings.length === 0;

  return (
    <>
      <div className="mt-4">
        <p className="font-mono text-[40px] leading-none tabular-nums tracking-tight lg:text-[56px]">{usd.format(value)}</p>
        <p className={`mt-2 font-mono text-sm tabular-nums ${up ? "text-go" : "text-block"}`}>
          {up ? "+" : "-"}{usd.format(Math.abs(delta))} ({pct(base ? (delta / base) * 100 : 0)}) <span className="text-muted">· {cost !== null ? "All time" : range}</span>
        </p>
      </div>
      {preview && <p className="mt-3 text-xs text-warn">Sample holdings, not your wallet. <button className="underline" onClick={() => setPreview(false)}>Back to my wallet</button></p>}

      {!empty && (
        <section className="glass mt-4 rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div className="glass grid grid-cols-2 rounded-full p-1">
              {(["area", "bar"] as const).map((t) => (
                <button key={t} onClick={() => setChartType(t)} className={`rounded-full px-3 py-1 text-xs capitalize ${t === chartType ? "bg-white text-black" : "text-muted"}`}>{t === "area" ? "Line" : "Bars"}</button>
              ))}
            </div>
            <div className="glass grid grid-cols-4 rounded-full p-1">
              {RANGES.map((r) => (
                <button key={r} onClick={() => setRange(r)} className={`rounded-full px-3 py-1 font-mono text-xs ${r === range ? "bg-white/15 text-white" : "text-muted"}`}>
                  {r === "1Y" ? "ALL" : r}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 px-2 pb-2">
            <ValueChart points={series} type={chartType} />
          </div>
          <p className="px-4 pb-4 text-xs text-muted">Portfolio value from each holding&apos;s on-chain price history. Touch or hover the chart for the value at that time.</p>
        </section>
      )}

      <div className="lg:mt-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <section className="glass mt-4 rounded-3xl">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-lg">Holdings</h2>
          <span className="text-xs text-muted">{holdings.length} {holdings.length === 1 ? "asset" : "assets"}{quotes.isFetching && " · updating"}</span>
        </div>
        {holdings.length > 3 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search holdings" className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-full border border-line bg-white/5 px-4 py-2 text-sm outline-none placeholder:text-muted" />
        )}
        {empty ? (
          <div className="p-4 pt-3 text-sm text-muted">
            {!address ? "Connect your wallet to see your stocks." : balances.isLoading || quotes.isLoading ? "Reading your wallet…" : "No stocks yet. Pick one from Markets to make your first buy."}
            <div className="mt-4 flex gap-2">
              <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black">Browse markets</Link>
              <button onClick={() => setPreview(true)} className="rounded-full border border-line px-4 py-2 text-sm text-white">Preview with sample</button>
            </div>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {shown.length === 0 && <li className="px-4 py-5 text-center text-sm text-muted">No holding matches “{q}”.</li>}
            {shown.map((h) => {
              const worth = h.shares * h.onchain;
              const change = h.cost != null ? ((worth - h.cost) / h.cost) * 100 : h.series.length > 1 ? ((h.onchain - h.series[0][1]) / h.series[0][1]) * 100 : null;
              return (
                <li key={h.ticker}>
                  <Link href={`/stock/${h.ticker}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5">
                    <Logo src={h.icon} name={h.name} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.name}</span>
                      <span className="block font-mono text-xs text-muted tabular-nums">{h.shares.toFixed(4)} shares · {usd.format(h.onchain)}</span>
                    </span>
                    <span className="text-right font-mono tabular-nums">
                      <span className="block">{usd.format(worth)}</span>
                      <span className={`block text-xs ${change === null ? "text-muted" : change < 0 ? "text-block" : "text-go"}`}>{change === null ? "—" : pct(change)}</span>
                    </span>
                    <span aria-hidden className="text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {!empty && (
        <div>
          <section className="glass mt-4 rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg">Allocation</h2>
              <span className="text-xs text-muted">by value</span>
            </div>
            <div className="mt-4">
              <AllocationPie slices={holdings.map((h) => ({ label: h.name, value: h.shares * h.onchain }))} />
            </div>
          </section>
          <Dividends holdings={holdings} />
        </div>
      )}
      {!preview && !empty && <p className="mt-3 text-xs text-muted lg:col-span-2">Live from your wallet, refreshed every 30s. P&amp;L uses purchases made in this app on this device.</p>}
      </div>
    </>
  );
}

// PRD F5: dividends are not paid out, the issuer reinvests them by raising the share multiplier.
// So shares × (1 − 1/multiplier) is the part of each holding that came from dividends.
function Dividends({ holdings }: { holdings: Holding[] }) {
  const rows = holdings.map((h) => {
    const fromDividends = h.shares * (1 - 1 / h.multiplier);
    return { ...h, fromDividends, worth: fromDividends * h.onchain, yearly: h.dividendYield === null ? null : h.shares * h.onchain * (h.dividendYield / 100) };
  });
  const reinvested = rows.reduce((n, r) => n + r.worth, 0);
  const yearly = rows.some((r) => r.yearly !== null) ? rows.reduce((n, r) => n + (r.yearly ?? 0), 0) : null;
  return (
    <section className="glass mt-4 rounded-3xl">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-lg">Dividends</h2>
        <span className="text-xs text-muted">reinvested automatically</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 px-4">
        <div>
          <p className="text-xs text-muted">Reinvested so far</p>
          <p className="mt-0.5 font-mono text-xl tabular-nums text-go">{usd.format(reinvested)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Expected next 12 months</p>
          <p className="mt-0.5 font-mono text-xl tabular-nums">{yearly === null ? "—" : usd.format(yearly)}</p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <li key={r.ticker} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.name}</span>
              <span className="block font-mono text-xs text-muted tabular-nums">
                {r.fromDividends.toFixed(4)} sh from dividends{r.dividendYield !== null && ` · ${r.dividendYield.toFixed(2)}% / yr`}
              </span>
            </span>
            <span className="text-right font-mono tabular-nums">
              <span className="block text-go">+{usd.format(r.worth)}</span>
              <span className="block text-xs text-muted">{((r.multiplier - 1) * 100).toFixed(2)}% of shares</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-4 pt-3 text-xs text-muted">Read from each token&apos;s share multiplier: every dividend the issuer received became extra shares in your wallet, no claiming needed.</p>
    </section>
  );
}
