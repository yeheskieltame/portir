"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./logo";

const TABS = [
  { href: "/portfolio", label: "Portfolio", d: "M5 20V10M12 20V4M19 20v-7" },
  { href: "/", label: "Markets", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z" },
  { href: "/plans", label: "Plans", d: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" },
  { href: "/profile", label: "Profile", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
] as const;

const Icon = ({ d, on }: { d: string; on: boolean }) => (
  <svg key={on ? "on" : "off"} viewBox="0 0 24 24" className={`size-5 ${on ? "animate-pop" : ""}`} fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Bottom tab bar on phones, a left sidebar from `lg` up. One active pill slides between tabs in both. */
export function Nav() {
  const path = usePathname();
  const index = TABS.findIndex((t) => (t.href === "/" ? path === "/" || path.startsWith("/stock/") || path.startsWith("/basket/") : path.startsWith(t.href)));
  return (
    <>
      <nav className="glass fixed bottom-4 left-1/2 z-20 grid w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] -translate-x-1/2 grid-cols-4 rounded-full p-1.5 lg:hidden">
        {index >= 0 && (
          <span aria-hidden className="absolute inset-y-1.5 w-[calc(25%-0.375rem)] rounded-full bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_0_24px_rgba(97,166,246,.25)] transition-[left] duration-500 ease-[cubic-bezier(.22,1,.36,1)]" style={{ left: `calc(${index} * 25% + 0.375rem)` }} />
        )}
        {TABS.map((t, i) => (
          <Link key={t.href} href={t.href} className={`relative flex flex-col items-center gap-1 rounded-full py-2 text-[11px] transition-[transform,color] duration-300 active:scale-90 ${i === index ? "text-white" : "text-muted"}`}>
            <Icon d={t.d} on={i === index} />
            {t.label}
          </Link>
        ))}
      </nav>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-paper/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <Link href="/" className="px-3 text-2xl tracking-tight">
          <Mark size={22} className="mr-2 inline-block align-[-2px]" />Port<span className="serif-italic text-[1.2em]">ir</span>
        </Link>
        <nav className="relative mt-8 flex flex-col gap-1">
          {index >= 0 && (
            <span aria-hidden className="absolute left-0 right-0 h-11 rounded-2xl bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_0_24px_rgba(97,166,246,.2)] transition-[top] duration-500 ease-[cubic-bezier(.22,1,.36,1)]" style={{ top: `calc(${index} * (2.75rem + 0.25rem))` }} />
          )}
          {TABS.map((t, i) => (
            <Link key={t.href} href={t.href} className={`relative flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors ${i === index ? "text-white" : "text-muted hover:text-white"}`}>
              <Icon d={t.d} on={i === index} />
              {t.label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto px-3 text-xs leading-relaxed text-muted">
          US stocks on BNB Chain, bought at a fair price. The Guard checks the session and the exchange price before every order.
        </p>
      </aside>
    </>
  );
}
