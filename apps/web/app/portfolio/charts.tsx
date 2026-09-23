"use client";

import { useState } from "react";
import { pct, usd } from "@/app/verdict";

export interface Point {
  t: number;
  v: number;
}
export type ChartType = "area" | "bar";

const W = 100, H = 100; // percent space; shapes stretch, text stays HTML so nothing distorts
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Portfolio value over time. Area or bars, hover/touch for the exact value, y-grid with dollar labels. */
export function ValueChart({ points, type }: { points: Point[]; type: ChartType }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <div className="grid h-56 place-items-center px-6 text-center text-sm text-muted">Your history starts with your first purchase. Check back after a few hours, or pick 1D.</div>;

  // Bars: at most 40, each the mean of its slice, coloured by direction.
  const bars = type === "bar" ? bucket(points, 40) : points;
  const vals = bars.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || hi * 0.02 || 1) * 0.12;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => (i / (bars.length - 1)) * W;
  const y = (v: number) => H - ((v - y0) / (y1 - y0)) * H;
  const up = bars[bars.length - 1].v >= bars[0].v;
  const color = up ? "var(--color-go)" : "var(--color-block)";
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + (y1 - y0) * f);
  const i = hover ?? bars.length - 1;
  const p = bars[i];
  const first = bars[0].v;

  const line = bars.map((b, k) => `${k ? "L" : "M"}${x(k).toFixed(2)} ${y(b.v).toFixed(2)}`).join(" ");
  const bw = (W / bars.length) * 0.7;

  return (
    <div
      className="relative h-56 select-none pl-12 pr-2 pb-6 pt-2 lg:h-72"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left - 48) / (r.width - 48 - 8);
        setHover(Math.max(0, Math.min(bars.length - 1, Math.round(f * (bars.length - 1)))));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {/* y grid + labels */}
      {grid.map((g, k) => (
        <div key={k} className="absolute left-0 right-2 flex items-center" style={{ top: `calc(0.5rem + ${(y(g) / H).toFixed(4)} * (100% - 2rem))` }}>
          <span className="w-11 pr-2 text-right font-mono text-[10px] text-muted tabular-nums">{short(g)}</span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>
      ))}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="relative h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {type === "area" ? (
          <>
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#pv)" />
            <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        ) : (
          bars.map((b, k) => {
            const prev = bars[k - 1]?.v ?? b.v;
            const top = y(Math.max(b.v, y0)), base = H;
            return <rect key={k} x={x(k) - bw / 2} y={top} width={bw} height={Math.max(0.5, base - top)} fill={b.v >= prev ? "var(--color-go)" : "var(--color-block)"} opacity={hover === null || hover === k ? 0.9 : 0.35} rx="0.4" />;
          })
        )}
        {hover !== null && <line x1={x(i)} x2={x(i)} y1="0" y2={H} stroke="rgba(255,255,255,.4)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
        {type === "area" && <circle cx={x(i)} cy={y(p.v)} r="1.2" fill="#fff" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* x labels */}
      <div className="absolute bottom-0 left-12 right-2 flex justify-between font-mono text-[10px] text-muted">
        <span>{day(bars[0].t)}</span>
        <span>{day(bars[Math.floor(bars.length / 2)].t)}</span>
        <span>{day(bars[bars.length - 1].t)}</span>
      </div>
      {/* tooltip */}
      <div
        className={`pointer-events-none absolute top-2 z-10 whitespace-nowrap rounded-xl border border-line bg-[#0b111c] px-3 py-2 text-xs shadow-[0_8px_30px_rgba(0,0,0,.5)] ${x(i) > 70 ? "-translate-x-full" : x(i) < 30 ? "" : "-translate-x-1/2"}`}
        style={{ left: `calc(3rem + ${(x(i) / W).toFixed(4)} * (100% - 3.5rem))` }}
      >
        <p className="font-mono text-sm tabular-nums">{usd.format(p.v)}</p>
        <p className={`font-mono tabular-nums ${p.v >= first ? "text-go" : "text-block"}`}>{pct(first ? ((p.v - first) / first) * 100 : 0)} <span className="text-muted">vs start</span></p>
        <p className="text-muted">{when(p.t)}</p>
      </div>
    </div>
  );
}

function bucket(points: Point[], n: number): Point[] {
  if (points.length <= n) return points;
  const size = points.length / n;
  return Array.from({ length: n }, (_, k) => {
    const slice = points.slice(Math.floor(k * size), Math.max(Math.floor(k * size) + 1, Math.floor((k + 1) * size)));
    return { t: slice[slice.length - 1].t, v: slice.reduce((s, p) => s + p.v, 0) / slice.length };
  });
}

const short = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${v.toFixed(0)}`);

export const PALETTE = ["#61a6f6", "#7ef0b0", "#ffb040", "#c084fc", "#22d3ee", "#f472b6", "#a3e635", "#fb7185"];

/** Allocation donut: one slice per holding, tap or hover a slice or legend row to read it. */
export function AllocationPie({ slices }: { slices: { label: string; value: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return null;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const R = 42, r = 28, C = 50;
  // Cumulative start angles, computed up front so render stays pure.
  const starts = sorted.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1] + (s.value / total) * Math.PI * 2], [-Math.PI / 2]);
  const arcs = sorted.map((s, k) => {
    const a0 = starts[k], a1 = starts[k + 1];
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const P = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)} ${(C + rad * Math.sin(a)).toFixed(2)}`;
    return { ...s, k, d: `M${P(R, a0)} A${R} ${R} 0 ${big} 1 ${P(R, a1)} L${P(r, a1)} A${r} ${r} 0 ${big} 0 ${P(r, a0)} Z`, share: s.value / total };
  });
  const shown = active === null ? null : arcs[active];
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="size-36 shrink-0 lg:size-44" role="img" aria-label="Allocation">
        {arcs.map((a) => (
          <path key={a.k} d={a.d} fill={PALETTE[a.k % PALETTE.length]} opacity={active === null || active === a.k ? 1 : 0.3} className="cursor-pointer transition-opacity" onPointerEnter={() => setActive(a.k)} onPointerLeave={() => setActive(null)} onClick={() => setActive(active === a.k ? null : a.k)} />
        ))}
        <text x="50" y="47" textAnchor="middle" className="fill-white" style={{ fontSize: 9, fontFamily: "var(--font-geist-mono)" }}>{shown ? `${(shown.share * 100).toFixed(0)}%` : slices.length}</text>
        <text x="50" y="58" textAnchor="middle" className="fill-white/60" style={{ fontSize: 5 }}>{shown ? shown.label.slice(0, 14) : slices.length === 1 ? "asset" : "assets"}</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {arcs.map((a) => (
          <li key={a.k} className={`flex cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 transition-colors ${active === a.k ? "bg-white/[0.08]" : ""}`} onPointerEnter={() => setActive(a.k)} onPointerLeave={() => setActive(null)} onClick={() => setActive(active === a.k ? null : a.k)}>
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: PALETTE[a.k % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="font-mono text-xs text-muted tabular-nums">{usd.format(a.value)}</span>
            <span className="w-11 text-right font-mono text-xs tabular-nums">{(a.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
