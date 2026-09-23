/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { Basket } from "@/lib/catalog";
import { Logo } from "./logo";

export const basketImage = (slug: string) => `/baskets/${slug}.jpg`;

/** Image card for a basket. `icons` (ticker → logo URL) adds the holdings' logos; without it the tickers are listed. */
export function BasketCard({ basket, icons, href = `/basket/${basket.slug}`, className = "" }: { basket: Basket; icons?: Record<string, string | null>; href?: string; className?: string }) {
  return (
    <Link href={href} className={`group relative block overflow-hidden rounded-3xl border border-line bg-[#0b111c] active:scale-[0.98] ${className}`}>
      <img src={basketImage(basket.slug)} alt="" className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#04070d] via-[#04070d]/55 to-transparent" />
      <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/80 backdrop-blur">Basket · {basket.legs.length}</span>
      <span className="absolute inset-x-4 bottom-4">
        <span className="block text-xl leading-tight tracking-tight">{basket.name}</span>
        {icons ? (
          <span className="mt-2.5 flex items-center">
            {basket.legs.map((l, i) => (
              <span key={l.ticker} className="rounded-full ring-2 ring-[#04070d]" style={{ marginLeft: i ? -8 : 0 }}>
                <Logo src={icons[l.ticker] ?? null} name={l.ticker} size={26} />
              </span>
            ))}
            <span className="ml-3 truncate font-mono text-[11px] text-muted">{basket.legs.map((l) => l.ticker).join(" · ")}</span>
          </span>
        ) : (
          <span className="mt-1.5 block truncate font-mono text-[11px] text-muted">{basket.legs.map((l) => l.ticker).join(" · ")}</span>
        )}
      </span>
    </Link>
  );
}
