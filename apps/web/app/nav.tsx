"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portfolio", label: "Portfolio", d: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/", label: "Markets", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z" },
  { href: "/plans", label: "Plans", d: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" },
  { href: "/profile", label: "Profile", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
] as const;

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/stock/")) return null; // the stock page has its own action bar; "← Markets" leads back
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="glass fixed bottom-4 left-1/2 z-20 grid w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] -translate-x-1/2 grid-cols-4 rounded-full px-2 py-2">
      {TABS.map((t) => {
        const on = active(t.href);
        return (
          <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 py-1 text-[11px] ${on ? "text-white" : "text-muted"}`}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.d} />
            </svg>
            {t.label}
            <span aria-hidden className={`h-0.5 w-6 rounded-full ${on ? "bg-white" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
