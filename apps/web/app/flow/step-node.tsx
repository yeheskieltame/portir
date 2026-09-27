"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Logo } from "@/app/logo";
import type { Status, StepKind, StepNode } from "./model";

const ICON: Record<StepKind, string> = {
  trigger: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  asset: "M4 19V9m5 10V5m5 14v-7m5 7V8",
  market: "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6",
  guard: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  funding: "M3 7h18v12H3zM3 11h18M7 15h3",
  buy: "M4 12h16m-5-5 5 5-5 5",
  deliver: "M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  record: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  window: "M12 7v5l3 2M4 4v5h5M20 12a8 8 0 1 1-2.3-5.7L20 9",
  skip: "M5 5l14 14M19 5 5 19",
};

const TONE: Record<Status, { ring: string; pill: string; label: string; dot: string }> = {
  idle: { ring: "border-white/12", pill: "text-muted border-white/15 bg-white/5", label: "", dot: "bg-white/30" },
  passed: { ring: "border-go/45 shadow-[0_0_24px_-6px_rgba(126,240,176,.45)]", pill: "text-go border-go/40 bg-go/10", label: "Passed", dot: "bg-go" },
  waiting: { ring: "border-warn/50 shadow-[0_0_26px_-6px_rgba(255,176,64,.5)] flow-pulse", pill: "text-warn border-warn/40 bg-warn/10", label: "Waiting", dot: "bg-warn" },
  stopped: { ring: "border-block/50 shadow-[0_0_24px_-6px_rgba(255,107,107,.5)]", pill: "text-block border-block/40 bg-block/10", label: "Stopped", dot: "bg-block" },
  skipped: { ring: "border-white/12 opacity-60", pill: "text-muted border-white/15 bg-white/5", label: "Skipped", dot: "bg-white/30" },
};

const dot = "!size-2.5 !border-2 !border-[#0b111c] !bg-white/40";

type H = { id: string; type: "source" | "target"; pos: Position };
/** Where each connection point sits: wide flows left to right with the wait branch above, tall flows downward. */
const SIDE = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom } as const;
function handlesOf(data: StepNode["data"]): H[] {
  return data.handles ? data.handles.map((h) => ({ id: h.id, type: h.type, pos: SIDE[h.side] })) : handles(data.kind, data.layout ?? "wide");
}

function handles(k: StepKind, layout: "wide" | "tall"): H[] {
  const wide = layout === "wide";
  const P = Position;
  const flowIn: H = { id: "in", type: "target", pos: wide ? P.Left : P.Top };
  const flowOut: H = { id: "out", type: "source", pos: wide ? P.Right : P.Bottom };
  const branch: H = { id: "no", type: "source", pos: wide ? P.Top : P.Right };
  switch (k) {
    case "trigger":
      return [flowOut, { id: "loop", type: "target", pos: wide ? P.Top : P.Right }];
    case "market":
    case "guard":
      return [flowIn, flowOut, branch];
    case "funding":
      return [flowIn, { id: "down", type: "source", pos: P.Bottom }, branch];
    case "record":
      return [flowIn, { id: "side", type: "target", pos: P.Right }];
    case "window":
      return [
        { id: "from", type: "target", pos: wide ? P.Bottom : P.Left },
        { id: "retry", type: "source", pos: wide ? P.Left : P.Top },
        { id: "skip", type: "source", pos: wide ? P.Right : P.Bottom },
      ];
    case "skip":
      return [{ id: "in", type: "target", pos: wide ? P.Left : P.Top }, { id: "out", type: "source", pos: wide ? P.Right : P.Left }];
    default:
      return [flowIn, flowOut];
  }
}

export function StepNodeView({ data }: NodeProps<StepNode>) {
  const t = TONE[data.status];
  const k = data.kind;
  if (data.compact) {
    const l = data.icons?.[0];
    return (
      <div className={`flex w-[230px] items-center gap-2.5 rounded-xl border bg-[#0d1420]/90 px-3 py-2 backdrop-blur-md ${t.ring}`}>
        {handlesOf(data).map((h) => (
          <Handle key={h.id} id={h.id} type={h.type} position={h.pos} className={dot} style={h.pos === Position.Left || h.pos === Position.Right ? { top: 25 } : undefined} />
        ))}
        {l && <Logo src={l.icon ?? null} name={l.ticker} size={26} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight text-white">{data.title}</p>
          <p className="truncate text-[11px] text-muted">{data.lines[0]}</p>
        </div>
        <span className={`size-2 shrink-0 rounded-full ${t.dot}`} />
      </div>
    );
  }
  return (
    <div
      className={`w-[240px] rounded-2xl border bg-[#0d1420]/90 p-3.5 backdrop-blur-md transition-shadow ${t.ring} ${data.selected ? "!border-brand ring-2 ring-brand/40" : ""} ${data.editable ? "cursor-pointer hover:border-white/35" : ""} ${data.status === "skipped" ? "line-through decoration-white/30" : ""}`}
    >
      {handlesOf(data).map((h) => (
        // Side handles sit at a fixed height so edges between nodes of different heights stay straight.
        <Handle key={h.id} id={h.id} type={h.type} position={h.pos} className={dot} style={h.pos === Position.Left || h.pos === Position.Right ? { top: data.compact ? 25 : 30 } : undefined} />
      ))}

      <div className="flex items-start gap-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${data.status === "idle" || data.status === "skipped" ? "border-white/10 bg-white/5 text-white/70" : `${t.pill}`}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICON[k]} />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{data.pill}</span>
            {t.label && (
              <span className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium no-underline ${t.pill}`}>
                <span className={`size-1.5 rounded-full ${t.dot}`} />
                {t.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[15px] font-medium leading-tight text-white">{data.title}</p>
        </div>
      </div>
      {data.icons && data.icons.length > 0 && (
        <div className="mt-2.5 flex items-center">
          {data.icons.slice(0, 6).map((l, i) => (
            <span key={l.ticker} className="rounded-full ring-2 ring-[#0d1420]" style={{ marginLeft: i ? -7 : 0 }} title={l.ticker}>
              <Logo src={l.icon ?? null} name={l.ticker} size={22} />
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 space-y-0.5">
        {data.lines.map((line) => (
          <p key={line} className="truncate text-[11.5px] leading-snug text-muted">{line}</p>
        ))}
      </div>
      {data.editable && <p className="mt-2 text-[10.5px] text-brand">Tap to change</p>}
    </div>
  );
}

export const nodeTypes = { step: StepNodeView };
