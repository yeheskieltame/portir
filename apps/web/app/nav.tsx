"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Stocks" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/plans", label: "Plans" },
  { href: "/profile", label: "Profile" },
] as const;

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/stock/")) return null; // the stock page has its own action bar; "← Stocks" leads back
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="glass fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-0.5 rounded-full p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-full px-3.5 py-2 text-[13px] font-medium ${active(t.href) ? "bg-white text-black" : "text-white"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
