import type { AssetKind } from "@portir/core/binance";
import Link from "next/link";
import { BASKETS } from "@/lib/catalog";
import { PER_PAGE, loadMarket } from "@/lib/live";
import { Logo } from "./logo";
import { decide, pct, toneOf, usd } from "./verdict";

const SESSION: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "text-go border-go/40" },
  pre: { label: "Pre-market", cls: "text-warn border-warn/40" },
  after: { label: "After hours", cls: "text-warn border-warn/40" },
  closed: { label: "Closed", cls: "text-muted border-line" },
};

// Prices are fetched on the server: binance.com is blocked for browsers on Indonesian ISPs.
export const revalidate = 30;

const KINDS: { value: AssetKind | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "stock", label: "Stocks" },
  { value: "etf", label: "ETFs" },
];

export default async function Markets({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const kind = sp.kind === "stock" || sp.kind === "etf" ? sp.kind : undefined;
  const page = Number(sp.page) || 1;
  const { stocks, total, page: current, pages, error } = await loadMarket({ q, kind, page });
  const open = stocks.some((s) => s.session === "open");
  const href = (p: Partial<{ q: string; kind: string; page: number }>) => {
    const u = new URLSearchParams();
    const next = { q, kind: kind ?? "", page: 1, ...p };
    if (next.q) u.set("q", next.q);
    if (next.kind) u.set("kind", next.kind);
    if (next.page > 1) u.set("page", String(next.page));
    return `/?${u}`;
  };

  return (
    <>
      <p className="mt-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        <span aria-hidden className={`size-2 rounded-full ${open ? "bg-go shadow-[0_0_10px_var(--color-go)]" : "bg-warn shadow-[0_0_10px_var(--color-warn)]"}`} />
        NYSE {open ? "open · Guard watching" : "closed · Guard waiting"}
      </p>
      <h1 className="mt-3 max-w-2xl text-[34px] leading-[1] tracking-[-0.03em] lg:text-[52px]">
        Own a piece of the companies <span className="serif-italic text-[1.1em]">you know.</span>
      </h1>
      {error && (
        <p role="status" className="mt-4 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
          Sample prices. Live market data could not be loaded{process.env.NODE_ENV === "production" ? "" : ` (${error})`}.
        </p>
      )}

      {!q && !kind && current === 1 && (
        <div className="mt-5 flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:grid-cols-4 lg:overflow-visible">
          {BASKETS.map((b) => (
            <Link key={b.slug} href={`/basket/${b.slug}`} className="glass w-44 shrink-0 snap-start rounded-3xl p-4 transition-colors active:scale-95 lg:w-auto lg:p-5 lg:hover:bg-white/10">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Basket · {b.legs.length}</span>
              <span className="mt-2 block text-lg leading-tight">{b.name}</span>
              <span className="mt-2 block truncate font-mono text-[11px] text-muted">{b.legs.map((l) => l.ticker).join(" · ")}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="lg:mt-8 lg:flex lg:items-center lg:gap-4">
        <form action="/" className="glass mt-5 flex items-center gap-2 rounded-full px-4 lg:mt-0 lg:max-w-md lg:flex-1">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <span aria-hidden className="text-muted">⌕</span>
          <input name="q" defaultValue={q} placeholder="Search NVIDIA, TSLA, ETF…" enterKeyHint="search" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted" />
          {q && <Link href={href({ q: "" })} className="text-muted" aria-label="Clear search">×</Link>}
        </form>
        <div className="mt-3 flex items-center gap-1.5 lg:mt-0 lg:flex-1">
          {KINDS.map((k) => (
            <Link key={k.value} href={href({ kind: k.value })} className={`rounded-full px-3 py-1.5 text-xs font-medium ${(kind ?? "") === k.value ? "bg-white text-black" : "glass text-white"}`}>
              {k.label}
            </Link>
          ))}
          <span className="ml-auto font-mono text-[11px] text-muted">{total} listed</span>
        </div>
      </div>

      <div className="mt-4 hidden grid-cols-[2.5rem_1fr_7rem_8rem_7rem_6rem_1rem] items-center gap-3 px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted lg:grid">
        <span /><span>Company</span><span>Session</span><span>Guard</span><span className="text-right">Exchange</span><span className="text-right">Price · 24h</span><span />
      </div>
      <ul className="glass mt-4 divide-y divide-line rounded-3xl lg:mt-2">
        {stocks.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
        {stocks.map((s) => {
          const d = decide(s);
          const tone = toneOf(d);
          const change = s.change24hPct;
          return (
            <li key={s.ticker}>
              <Link href={`/stock/${s.ticker}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-white/5 lg:grid lg:grid-cols-[2.5rem_1fr_7rem_8rem_7rem_6rem_1rem] lg:hover:bg-white/5">
                <Logo src={s.icon} name={s.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <span className="font-mono">{s.ticker}</span>
                    {s.kind === "etf" && <span className="rounded border border-line px-1 text-[10px] uppercase">ETF</span>}
                    <span className={`rounded border px-1 text-[10px] lg:hidden ${SESSION[s.session].cls}`}>{SESSION[s.session].label}</span>
                    <span aria-hidden className={`size-1.5 rounded-full lg:hidden ${tone.dot}`} />
                    <span className="lg:hidden">{tone.label}</span>
                  </span>
                </span>
                <span className={`hidden text-xs lg:block ${SESSION[s.session].cls.split(" ")[0]}`}>{SESSION[s.session].label}</span>
                <span className="hidden items-center gap-1.5 text-xs lg:flex">
                  <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
                  {tone.label}
                </span>
                <span className="hidden text-right font-mono text-xs text-muted tabular-nums lg:block">{s.reference === null ? "—" : usd.format(s.reference)}</span>
                <span className="text-right">
                  <span className="block font-mono tabular-nums">{usd.format(s.onchain)}</span>
                  <span className={`block font-mono text-xs tabular-nums ${change === null ? "text-muted" : change < 0 ? "text-block" : "text-go"}`}>
                    {change === null ? "—" : pct(change)}
                  </span>
                </span>
                <span aria-hidden className="text-muted">›</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          <Link href={href({ page: current - 1 })} aria-disabled={current === 1} className={`glass rounded-full px-4 py-2 ${current === 1 ? "pointer-events-none opacity-40" : ""}`}>← Prev</Link>
          <span className="font-mono text-xs text-muted">
            {(current - 1) * PER_PAGE + 1}–{Math.min(current * PER_PAGE, total)} of {total}
          </span>
          <Link href={href({ page: current + 1 })} aria-disabled={current === pages} className={`glass rounded-full px-4 py-2 ${current === pages ? "pointer-events-none opacity-40" : ""}`}>Next →</Link>
        </nav>
      )}
    </>
  );
}
