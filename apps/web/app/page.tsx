import Link from "next/link";
import { loadCatalog } from "@/lib/live";
import { Logo } from "./logo";
import { decide, pct, toneOf, usd } from "./verdict";

// Prices are fetched on the server: binance.com is blocked for browsers on Indonesian ISPs.
export const revalidate = 30;

export default async function Catalog() {
  const { stocks, error } = await loadCatalog();
  const open = stocks.some((s) => s.session === "open");
  return (
    <>
      <p className="mt-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        <span aria-hidden className={`size-2 rounded-full ${open ? "bg-go shadow-[0_0_10px_var(--color-go)]" : "bg-warn shadow-[0_0_10px_var(--color-warn)]"}`} />
        NYSE {open ? "open · Guard watching" : "closed · Guard waiting"}
      </p>
      <h1 className="mt-3 text-[34px] leading-[1] tracking-[-0.03em]">
        Own a piece of the companies <span className="serif-italic text-[1.1em]">you know.</span>
      </h1>
      <p className="mt-3 text-sm text-muted">We check the US market and the price before every order, so you never overpay at 3 AM.</p>
      {error && (
        <p role="status" className="mt-4 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
          Sample prices. Live market data could not be loaded{process.env.NODE_ENV === "production" ? "" : ` (${error})`}.
        </p>
      )}

      <ul className="glass mt-6 divide-y divide-line rounded-3xl">
        {stocks.map((s) => {
          const d = decide(s);
          const tone = toneOf(d);
          const change = s.change24hPct;
          return (
            <li key={s.ticker}>
              <Link href={`/stock/${s.ticker}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5">
                <Logo src={s.icon} name={s.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <span className="font-mono">{s.ticker}</span>
                    <span aria-hidden>·</span>
                    <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
                    {tone.label}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono tabular-nums">{usd.format(s.onchain)}</span>
                  <span className={`block font-mono text-xs tabular-nums ${change === null ? "text-muted" : change < 0 ? "text-block" : "text-go"}`}>
                    {change === null ? "—" : pct(change)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-center text-xs text-muted">Tap a stock for the chart, the Guard&apos;s reasoning and every provider&apos;s price.</p>
    </>
  );
}
