import type { Candle } from "@portir/core/binance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/app/logo";
import { NA_REASON, compact, decide, pct, toneOf, usd } from "@/app/verdict";
import { RANGES, type Range, loadStock } from "@/lib/live";
import { BuySheet } from "@/app/buy-sheet";

export const revalidate = 30;

const SESSION: Record<string, string> = { open: "Market open", pre: "Pre-market", after: "After hours", closed: "Market closed" };

export default async function StockPage({ params, searchParams }: PageProps<"/stock/[ticker]">) {
  const { ticker } = await params;
  const { range: r } = await searchParams;
  const range: Range = typeof r === "string" && r in RANGES ? (r as Range) : "1W";
  const detail = await loadStock(ticker.toUpperCase(), range);
  if (!detail) notFound();

  const { stock: s, meta, candles, sample } = detail;
  const d = decide(s);
  const tone = toneOf(d);
  const change = s.change24hPct;
  const stats = s.stats;
  const inRange = stats?.low52w != null && stats.high52w != null && stats.high52w > stats.low52w
    ? Math.min(1, Math.max(0, (s.onchain - stats.low52w) / (stats.high52w - stats.low52w)))
    : null;

  return (
    <>
      {/* Stays at the top while the page scrolls, so "back" is always one tap away. */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-paper/85 px-4 py-2 backdrop-blur-md">
        <Link href="/" className="glass inline-flex size-9 items-center justify-center rounded-full text-base" aria-label="Back to markets">
          ←
        </Link>
        <span className="font-mono text-xs text-muted">
          {s.ticker} · {usd.format(s.onchain)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Logo src={s.icon} name={s.name} size={48} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl leading-tight tracking-tight">{s.name}</h1>
          <p className="font-mono text-xs text-muted">
            {s.ticker} · {SESSION[s.session]}
          </p>
        </div>
      </div>
      <p className="mt-4 font-mono text-[40px] leading-none tabular-nums tracking-tight">{usd.format(s.onchain)}</p>
      <p className="mt-1 flex items-center gap-2 font-mono text-xs tabular-nums">
        <span className={change === null ? "text-muted" : change < 0 ? "text-block" : "text-go"}>{change === null ? "—" : pct(change)} today</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{s.reference === null ? "exchange n/a" : `exchange ${usd.format(s.reference)}`}</span>
      </p>

      <Chart candles={candles} />
      <div className="mt-3 flex gap-1">
        {(Object.keys(RANGES) as Range[]).map((k) => (
          <Link
            key={k}
            href={`?range=${k}`}
            scroll={false}
            className={`rounded-full px-3 py-1 font-mono text-xs ${k === range ? "bg-white text-black" : "text-muted"}`}
          >
            {k}
          </Link>
        ))}
        {sample && <span className="ml-auto self-center text-xs text-muted">sample data</span>}
      </div>

      <section className="glass mt-6 rounded-3xl p-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>{tone.label}</span>
          {d && <span className="font-mono text-xs text-muted tabular-nums">{pct(d.spreadBps / 100)} vs exchange</span>}
        </div>
        <p className="mt-3 text-sm">{d ? d.reason : NA_REASON}</p>
        <p className="mt-2 text-xs text-muted">The Guard checks the session, the premium over the exchange price and every provider before you pay.</p>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href={`/plans?target=${s.ticker}`} className="glass rounded-full py-3 text-center text-sm font-medium active:scale-95">
          Set up a plan
        </Link>
        <BuySheet name={s.name} legs={[{ ticker: s.ticker, name: s.name, onchain: s.onchain, weight: 1 }]} />
      </div>

      {s.offers && s.offers.length > 0 && (
        <section className="mt-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Providers</h2>
          <ul className="glass mt-2 divide-y divide-line rounded-3xl">
            {s.offers.map((o, i) => (
              <li key={o.issuer} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="capitalize">{o.issuer}</span>
                  {i === 0 && <span className="ml-2 rounded-full border border-go/40 bg-go/10 px-2 py-0.5 text-[11px] text-go">used</span>}
                  {o.halted && <span className="block text-xs text-muted">paused · {o.halted}</span>}
                </span>
                <span className="text-right font-mono tabular-nums">
                  {usd.format(o.onchain)}
                  {o.spreadBps !== null && <span className="block text-xs text-muted">{pct(o.spreadBps / 100)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Key facts</h2>
        <div className="glass mt-2 rounded-3xl p-4">
          {inRange !== null && (
            <div className="mb-4">
              <div className="flex justify-between font-mono text-xs text-muted tabular-nums">
                <span>52w low {usd.format(stats!.low52w!)}</span>
                <span>high {usd.format(stats!.high52w!)}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                <div className="relative h-full rounded-full bg-brand" style={{ width: `${inRange * 100}%` }}>
                  <span className="absolute -right-1 -top-[3px] size-3 rounded-full border-2 border-paper bg-white" />
                </div>
              </div>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Fact label="Market cap" value={stats?.marketCap != null ? `$${compact.format(stats.marketCap)}` : "—"} />
            <Fact label="P/E ratio" value={stats?.pe != null ? stats.pe.toFixed(1) : "—"} />
            <Fact label="Dividend yield" value={stats?.dividendYield != null ? `${stats.dividendYield.toFixed(2)}%` : "—"} />
            <Fact label="On-chain holders" value={s.holders != null ? compact.format(s.holders) : "—"} />
          </dl>
        </div>
      </section>

      {meta?.company.description && (
        <section className="mt-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">About</h2>
          <div className="glass mt-2 rounded-3xl p-4 text-sm">
            <p className="text-muted">{meta.company.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3">
              <Fact label="Industry" value={meta.company.industry ?? "—"} />
              <Fact label="CEO" value={meta.company.ceo ?? "—"} />
            </dl>
          </div>
        </section>
      )}

    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

// ponytail: plain SVG line + fill, server-rendered. Candlesticks and hover if users ask.
function Chart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return <p className="mt-6 h-36 rounded-2xl border border-dashed border-line text-center text-xs leading-[9rem] text-muted">No price history yet.</p>;
  const W = 340, H = 140, P = 4;
  const closes = candles.map((c) => c.c);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const x = (i: number) => P + (i / (closes.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "var(--color-go)" : "var(--color-block)";
  const at = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <figure className="mt-5">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label="Price chart">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${x(closes.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`} fill="url(#fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex justify-between font-mono text-[11px] text-muted tabular-nums">
        <span>{at(candles[0].t)}</span>
        <span>
          {usd.format(lo)} – {usd.format(hi)}
        </span>
        <span>{at(candles[candles.length - 1].t)}</span>
      </figcaption>
    </figure>
  );
}
