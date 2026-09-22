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
  const index = TABS.findIndex((t) => (t.href === "/" ? path === "/" : path.startsWith(t.href)));
  return (
    <nav className="glass fixed bottom-4 left-1/2 z-20 grid w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] -translate-x-1/2 grid-cols-4 rounded-full p-1.5">
      {/* One pill slides between tabs instead of each tab lighting up. */}
      {index >= 0 && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 w-[calc(25%-0.375rem)] rounded-full bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_0_24px_rgba(97,166,246,.25)] transition-[left] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
          style={{ left: `calc(${index} * 25% + 0.375rem)` }}
        />
      )}
      {TABS.map((t, i) => {
        const on = i === index;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative flex flex-col items-center gap-1 rounded-full py-2 text-[11px] transition-[transform,color] duration-300 active:scale-90 ${on ? "text-white" : "text-muted"}`}
          >
            <svg key={on ? "on" : "off"} viewBox="0 0 24 24" className={`size-5 ${on ? "animate-pop" : ""}`} fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.d} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
