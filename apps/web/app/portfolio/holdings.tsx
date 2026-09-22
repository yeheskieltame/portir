"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { bsc } from "wagmi/chains";
import { useConnection, useReadContracts } from "wagmi";
import { Logo } from "@/app/logo";
import { pct, usd } from "@/app/verdict";

export interface HoldingStock {
  ticker: string;
  name: string;
  icon: string | null;
  onchain: number;
  change24hPct: number | null;
  tokens: { address: `0x${string}`; multiplier: number }[];
}
interface Holding extends HoldingStock {
  shares: number;
  /** USD paid, when known. Live balances have no purchase history yet. */
  cost?: number;
}

// Demo holdings so the screen can be judged before the first mainnet buy.
const SAMPLE: Record<string, { shares: number; cost: number }> = { NVDA: { shares: 0.42, cost: 78.5 }, AAPL: { shares: 1.2, cost: 276 }, SPY: { shares: 0.3, cost: 195 } };

export function Holdings({ stocks }: { stocks: HoldingStock[] }) {
  const { address } = useConnection();
  const [preview, setPreview] = useState(false);
  const calls = stocks.flatMap((s) => s.tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const, chainId: bsc.id })));
  const balances = useReadContracts({ contracts: calls, allowFailure: true, query: { enabled: !!address } });

  let live: Holding[] = [];
  if (balances.data) {
    let i = 0;
    live = stocks
      .map((s) => ({ ...s, shares: s.tokens.reduce((sum, t) => { const r = balances.data![i++]; return sum + (r.status === "success" ? Number(formatUnits(r.result as bigint, 18)) * t.multiplier : 0); }, 0) }))
      .filter((h) => h.shares > 0);
  }
  const holdings: Holding[] = preview
    ? stocks.filter((s) => s.ticker in SAMPLE).map((s) => ({ ...s, ...SAMPLE[s.ticker] }))
    : live;

  const value = holdings.reduce((sum, h) => sum + h.shares * h.onchain, 0);
  const cost = holdings.every((h) => h.cost != null) ? holdings.reduce((sum, h) => sum + h.cost!, 0) : null;
  const dayChange = holdings.reduce((sum, h) => sum + h.shares * h.onchain * ((h.change24hPct ?? 0) / 100), 0);

  return (
    <>
      <p className="mt-4 font-mono text-[40px] leading-none tabular-nums tracking-tight">{usd.format(value)}</p>
      <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs tabular-nums">
        <span className={dayChange < 0 ? "text-block" : "text-go"}>{dayChange >= 0 ? "+" : "-"}{usd.format(Math.abs(dayChange))} today</span>
        {cost !== null && holdings.length > 0 && (
          <span className={value - cost < 0 ? "text-block" : "text-go"}>
            {value - cost >= 0 ? "+" : "-"}{usd.format(Math.abs(value - cost))} all time ({pct(((value - cost) / cost) * 100)})
          </span>
        )}
      </p>
      {preview && <p className="mt-2 text-xs text-warn">Sample holdings, not your wallet.</p>}

      {holdings.length > 0 ? (
        <ul className="glass mt-6 divide-y divide-line rounded-3xl">
          {holdings.map((h) => (
            <li key={h.ticker}>
              <Link href={`/stock/${h.ticker}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5">
                <Logo src={h.icon} name={h.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.name}</span>
                  <span className="block font-mono text-xs text-muted tabular-nums">{h.shares.toFixed(4)} shares · {usd.format(h.onchain)}</span>
                </span>
                <span className="text-right font-mono tabular-nums">
                  <span className="block">{usd.format(h.shares * h.onchain)}</span>
                  {h.cost != null ? (
                    <span className={`block text-xs ${h.shares * h.onchain - h.cost < 0 ? "text-block" : "text-go"}`}>{pct(((h.shares * h.onchain - h.cost) / h.cost) * 100)}</span>
                  ) : (
                    <span className={`block text-xs ${(h.change24hPct ?? 0) < 0 ? "text-block" : "text-go"}`}>{h.change24hPct === null ? "—" : pct(h.change24hPct)}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="glass mt-6 rounded-3xl p-5 text-sm text-muted">
          {!address ? "Connect your wallet to see your stocks." : balances.isLoading ? "Reading your wallet…" : "No stocks yet. Pick one from the list to make your first buy."}
          <div className="mt-4 flex gap-2">
            <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black">Browse stocks</Link>
            <button onClick={() => setPreview(true)} className="rounded-full border border-line px-4 py-2 text-sm text-white">Preview with sample</button>
          </div>
        </div>
      )}
      {preview && (
        <button onClick={() => setPreview(false)} className="mt-3 text-xs text-muted underline">Back to my wallet</button>
      )}
      {!preview && holdings.length > 0 && (
        <p className="mt-3 text-xs text-muted">Shares include dividends reinvested by the issuer. Cost basis and P&amp;L arrive with the buy flow.</p>
      )}
    </>
  );
}
