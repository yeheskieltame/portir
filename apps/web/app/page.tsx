import { guard, type Verdict } from "@portir/core";
import { loadCatalog } from "@/lib/live";

const TONE: Record<Verdict, { dot: string; label: string }> = {
  GO: { dot: "bg-go", label: "Fair price" },
  WARN: { dot: "bg-warn", label: "Slightly pricey" },
  BLOCK: { dot: "bg-block", label: "Better to wait" },
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Prices are fetched on the server: binance.com is blocked for browsers on Indonesian ISPs.
export const revalidate = 30;

export default async function Catalog() {
  const { stocks, error } = await loadCatalog();
  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Own a piece of the companies you know.</h1>
      <p className="mt-2 text-sm text-muted">
        We check the US market and the price before every order, so you never overpay at 3 AM.
      </p>
      {error && (
        <p role="status" className="mt-4 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
          Sample prices. Live market data could not be loaded{process.env.NODE_ENV === "production" ? "" : ` (${error})`}.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {stocks.map((s) => {
          const d = s.reference === null ? null : guard({ ...s, reference: s.reference });
          const tone = d ? TONE[d.verdict] : { dot: "bg-muted", label: "Exchange price unavailable" };
          return (
            <li key={s.ticker} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{s.name}</h2>
                  <p className="font-mono text-xs text-muted">
                    {s.ticker} · Market {s.session === "open" ? "open" : "closed"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-medium tabular-nums">{usd.format(s.onchain)}</p>
                  <p className="font-mono text-xs text-muted tabular-nums">
                    Exchange {s.reference === null ? "n/a" : usd.format(s.reference)}
                  </p>
                </div>
              </div>
              <p className="mt-3 flex items-center gap-2 text-sm font-medium">
                <span aria-hidden className={`size-2 rounded-full ${tone.dot}`} />
                {tone.label}
              </p>
              <p className="mt-1 text-sm text-muted">
                {d ? d.reason : "We cannot compare this price to the exchange right now, so we would not buy yet."}
              </p>
              {s.offers && s.offers.length > 1 && (
                <details className="mt-3 border-t border-line pt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Compared {s.offers.length} providers</summary>
                  <ul className="mt-2 space-y-1 font-mono tabular-nums">
                    {s.offers.map((o, i) => (
                      <li key={o.issuer} className="flex justify-between gap-3">
                        <span>
                          {o.issuer}
                          {i === 0 && " · used"}
                          {o.halted && ` · paused (${o.halted})`}
                        </span>
                        <span>
                          {usd.format(o.onchain)}
                          {o.spreadBps !== null && ` (${o.spreadBps > 0 ? "+" : ""}${(o.spreadBps / 100).toFixed(2)}%)`}
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
