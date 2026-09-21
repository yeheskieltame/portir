import { guard, type Verdict } from "@portir/core";
import { SAMPLE_STOCKS } from "@/lib/catalog";

const TONE: Record<Verdict, { dot: string; label: string }> = {
  GO: { dot: "bg-go", label: "Fair price" },
  WARN: { dot: "bg-warn", label: "Slightly pricey" },
  BLOCK: { dot: "bg-block", label: "Better to wait" },
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function Catalog() {
  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Own a piece of the companies you know.</h1>
      <p className="mt-2 text-sm text-muted">
        We check the US market and the price before every order, so you never overpay at 3 AM.
      </p>
      <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
        Sample prices. Live market data is not connected yet.
      </p>

      <ul className="mt-4 space-y-3">
        {SAMPLE_STOCKS.map((s) => {
          const d = guard(s);
          const tone = TONE[d.verdict];
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
                  <p className="font-mono text-xs text-muted tabular-nums">Exchange {usd.format(s.reference)}</p>
                </div>
              </div>
              <p className="mt-3 flex items-center gap-2 text-sm font-medium">
                <span aria-hidden className={`size-2 rounded-full ${tone.dot}`} />
                {tone.label}
              </p>
              <p className="mt-1 text-sm text-muted">{d.reason}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
