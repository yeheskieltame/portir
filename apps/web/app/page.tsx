import { guard, type Verdict } from "@portir/core";
import { loadCatalog } from "@/lib/live";

const TONE: Record<Verdict, { chip: string; label: string }> = {
  GO: { chip: "text-go border-go/40 bg-go/10", label: "Fair price" },
  WARN: { chip: "text-warn border-warn/40 bg-warn/10", label: "Slightly pricey" },
  BLOCK: { chip: "text-block border-block/40 bg-block/10", label: "Better to wait" },
};
const NA = { chip: "text-muted border-line bg-white/5", label: "No exchange price" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pct = (bps: number) => `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

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

      <ul className="mt-6 space-y-3">
        {stocks.map((s) => {
          const d = s.reference === null ? null : guard({ ...s, reference: s.reference });
          const tone = d ? TONE[d.verdict] : NA;
          return (
            <li key={s.ticker} className="glass rounded-3xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium leading-tight">{s.name}</h2>
                  <p className="mt-1 font-mono text-xs text-muted">{s.ticker}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg tabular-nums">{usd.format(s.onchain)}</p>
                  <p className="font-mono text-xs text-muted tabular-nums">
                    {s.reference === null ? "exchange n/a" : `exchange ${usd.format(s.reference)}`}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>{tone.label}</span>
                {d && <span className="font-mono text-xs text-muted tabular-nums">{pct(d.spreadBps)} vs exchange</span>}
              </div>
              <p className="mt-2 text-sm text-muted">
                {d ? d.reason : "We cannot compare this price to the exchange right now, so we would not buy yet."}
              </p>
              {s.offers && s.offers.length > 1 && (
                <details className="mt-3 border-t border-line pt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Compared {s.offers.length} providers</summary>
                  <ul className="mt-2 space-y-1 font-mono tabular-nums">
                    {s.offers.map((o, i) => (
                      <li key={o.issuer} className="flex justify-between gap-3">
                        <span className={i === 0 ? "text-ink" : ""}>
                          {o.issuer}
                          {i === 0 && " · used"}
                          {o.halted && ` · paused (${o.halted})`}
                        </span>
                        <span>
                          {usd.format(o.onchain)}
                          {o.spreadBps !== null && ` (${pct(o.spreadBps)})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
