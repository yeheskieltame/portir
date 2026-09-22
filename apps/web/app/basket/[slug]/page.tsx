import Link from "next/link";
import { notFound } from "next/navigation";
import { BuySheet } from "@/app/buy-sheet";
import { Logo } from "@/app/logo";
import { NA, TONE, decide, pct, usd } from "@/app/verdict";
import { BASKETS } from "@/lib/catalog";
import { loadStocks } from "@/lib/live";

export const revalidate = 30;

const ORDER = { GO: 0, WARN: 1, BLOCK: 2 } as const;

export default async function BasketPage({ params }: PageProps<"/basket/[slug]">) {
  const { slug } = await params;
  const basket = BASKETS.find((b) => b.slug === slug);
  if (!basket) notFound();
  const { stocks, error } = await loadStocks(basket.legs.map((l) => l.ticker));
  const legs = basket.legs.flatMap((l) => {
    const s = stocks.find((x) => x.ticker === l.ticker);
    return s ? [{ ...l, stock: s, decision: decide(s) }] : [];
  });
  const missing = basket.legs.length - legs.length;
  // The basket is only as fair as its worst leg: one blocked leg holds the whole order.
  const worst = legs.reduce<keyof typeof ORDER | null>((w, l) => (l.decision && (w === null || ORDER[l.decision.verdict] > ORDER[w]) ? l.decision.verdict : w), null);
  const tone = worst ? TONE[worst] : NA;
  const weight = legs.reduce((n, l) => n + l.weight, 0);
  const change = legs.reduce((n, l) => n + (l.stock.change24hPct ?? 0) * (l.weight / weight), 0);

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-paper/85 px-4 py-2 backdrop-blur-md">
        <Link href="/" className="glass inline-flex size-9 items-center justify-center rounded-full text-base" aria-label="Back to markets">←</Link>
        <span className="font-mono text-xs text-muted">Basket · {legs.length} holdings</span>
      </div>

      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Basket</p>
      <h1 className="mt-1 text-[34px] leading-[1] tracking-[-0.03em]">{basket.name}</h1>
      <p className="mt-2 text-sm text-muted">{basket.blurb}</p>
      <p className={`mt-3 font-mono text-sm tabular-nums ${change < 0 ? "text-block" : "text-go"}`}>{pct(change)} today <span className="text-muted">· weighted</span></p>
      {error && <p role="status" className="mt-3 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">Sample prices. Live market data could not be loaded.</p>}

      <section className="glass mt-5 rounded-3xl p-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>{tone.label}</span>
          <span className="text-xs text-muted">across every holding</span>
        </div>
        <p className="mt-3 text-sm">
          {worst === "GO" && "Every holding is at a fair price right now. A $100 order becomes one guarded swap per holding."}
          {worst === "WARN" && "Some holdings are a little above their exchange price. You can buy anyway or wait."}
          {worst === "BLOCK" && "At least one holding is well above its exchange price, so the basket waits for a better window."}
          {worst === null && "The exchange price is not available right now, so the Guard cannot judge this basket yet."}
        </p>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href={`/plans?target=BASKET:${encodeURIComponent(basket.name)}`} className="glass rounded-full py-3 text-center text-sm font-medium active:scale-95">Set up a plan</Link>
        <BuySheet name={basket.name} legs={legs.map((l) => ({ ticker: l.ticker, name: l.stock.name, onchain: l.stock.onchain, weight: l.weight / weight }))} />
      </div>

      <section className="mt-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Composition · $100 buys</h2>
        <ul className="glass mt-2 divide-y divide-line rounded-3xl">
          {legs.map((l) => {
            const t = l.decision ? TONE[l.decision.verdict] : NA;
            const dollars = (100 * l.weight) / weight;
            return (
              <li key={l.ticker}>
                <Link href={`/stock/${l.ticker}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5">
                  <Logo src={l.stock.icon} name={l.stock.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.stock.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <span className="font-mono">{l.ticker}</span>
                      <span aria-hidden>·</span>
                      <span aria-hidden className={`size-1.5 rounded-full ${t.dot}`} />
                      {t.label}
                    </span>
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    <span className="block">{Math.round(dollars)}%</span>
                    <span className="block text-xs text-muted">{(dollars / l.stock.onchain).toFixed(4)} sh</span>
                  </span>
                  <span aria-hidden className="text-muted">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {missing > 0 && <p className="mt-2 text-xs text-muted">{missing} holding{missing > 1 ? "s" : ""} could not be priced and {missing > 1 ? "are" : "is"} left out for now.</p>}
        <p className="mt-2 text-xs text-muted">Fixed weights, on-chain tokens from the cheapest fair provider per holding. Prices {usd.format(legs.reduce((n, l) => n + l.stock.onchain * (l.weight / weight), 0))} per weighted share.</p>
      </section>
    </>
  );
}
