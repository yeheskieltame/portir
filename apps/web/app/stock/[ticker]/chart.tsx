"use client";

import { useState } from "react";
import { pct, usd } from "@/app/verdict";

export interface Candle {
  t: number;
  c: number;
}

const W = 340, H = 140, P = 4;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Same area chart as before, now with a crosshair and a tooltip that follows the finger or mouse. */
export function StockChart({ candles, reference }: { candles: Candle[]; reference: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (candles.length < 2) return <p className="mt-6 h-36 rounded-2xl border border-dashed border-line text-center text-xs leading-[9rem] text-muted">No price history yet.</p>;

  const closes = candles.map((c) => c.c);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const x = (i: number) => P + (i / (closes.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const i = hover ?? closes.length - 1;
  const p = candles[i];
  const first = closes[0];
  const up = closes[closes.length - 1] >= first;
  const color = up ? "var(--color-go)" : "var(--color-block)";
  const showRef = reference !== null && reference >= lo && reference <= hi;
  const xf = x(i) / W; // 0..1 across the drawing

  return (
    <figure className="mt-5">
      <div
        className="relative select-none touch-pan-y"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(closes.length - 1, Math.round(((e.clientX - r.left) / r.width) * (closes.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full lg:h-64" role="img" aria-label="Price chart">
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".35" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${x(closes.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`} fill="url(#fill)" />
          {showRef && <line x1="0" x2={W} y1={y(reference)} y2={y(reference)} stroke="rgba(255,255,255,.35)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {hover !== null && <line x1={x(i)} x2={x(i)} y1="0" y2={H} stroke="rgba(255,255,255,.45)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
          <circle cx={x(i)} cy={y(p.c)} r={hover === null ? 3 : 4} fill="#fff" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {showRef && <span className="pointer-events-none absolute right-0 -translate-y-full font-mono text-[10px] text-muted" style={{ top: `${(y(reference) / H) * 100}%` }}>exchange {usd.format(reference)}</span>}
        {hover !== null && (
          <div
            className={`pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-xl border border-line bg-[#0b111c] px-3 py-2 text-xs shadow-[0_8px_30px_rgba(0,0,0,.5)] ${xf > 0.7 ? "-translate-x-full" : xf < 0.3 ? "" : "-translate-x-1/2"}`}
            style={{ left: `${xf * 100}%` }}
          >
            <p className="font-mono text-sm tabular-nums">{usd.format(p.c)}</p>
            <p className={`font-mono tabular-nums ${p.c >= first ? "text-go" : "text-block"}`}>{pct(((p.c - first) / first) * 100)} <span className="text-muted">vs start</span></p>
            <p className="text-muted">{when(p.t)}</p>
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex justify-between font-mono text-[11px] text-muted tabular-nums">
        <span>{day(candles[0].t)}</span>
        <span>
          {usd.format(lo)} – {usd.format(hi)}
        </span>
        <span>{day(candles[candles.length - 1].t)}</span>
      </figcaption>
    </figure>
  );
}
