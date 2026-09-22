"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Stocks" },
  { href: "/plans", label: "Plans" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="glass fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-full p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-full px-5 py-2 text-sm font-medium ${path === t.href ? "bg-white text-black" : "text-white"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
