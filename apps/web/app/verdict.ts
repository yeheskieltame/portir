import { type Decision, type Verdict, guard } from "@portir/core";
import type { Stock } from "@/lib/catalog";

export const TONE: Record<Verdict, { chip: string; dot: string; label: string }> = {
  GO: { chip: "text-go border-go/40 bg-go/10", dot: "bg-go", label: "Fair price" },
  WARN: { chip: "text-warn border-warn/40 bg-warn/10", dot: "bg-warn", label: "Slightly pricey" },
  BLOCK: { chip: "text-block border-block/40 bg-block/10", dot: "bg-block", label: "Better to wait" },
};
export const NA = { chip: "text-muted border-line bg-white/5", dot: "bg-muted", label: "No exchange price" };
export const NA_REASON = "We cannot compare this price to the exchange right now, so we would not buy yet.";

export const decide = (s: Stock): Decision | null => (s.reference === null ? null : guard({ ...s, reference: s.reference }));
export const toneOf = (d: Decision | null) => (d ? TONE[d.verdict] : NA);

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
