"use client";

import type { Edge } from "@xyflow/react";
import { FlowCanvas } from "./canvas";
import { BRAND, type StepData, type StepKind, type StepNode } from "./model";

type Side = "left" | "right" | "top" | "bottom";
const h = (id: string, type: "source" | "target", side: Side) => ({ id, type, side });

/** How Loan Guard runs, lit from the latest rescue. A snake grid so it stays readable in a narrow column. */
const POOL_BRAND = { src: "/mark.svg", name: "Portir pool (testnet)" };
const VENUS_MAINNET = { src: "/logos/venus.png", name: "Venus (mainnet)" };

export function GuardFlow({ triggerPct, targetPct, cap, lastRescue, collateral }: { triggerPct: number; targetPct: number; cap: string; lastRescue?: { amount: string; before: number; after: number; at: number }; collateral?: { ticker: string; icon: string | null } }) {
  const stock = collateral?.icon ? { src: collateral.icon, name: collateral.ticker } : undefined;
  const rescued = !!lastRescue;
  const X = 270, Y = 215; // rows leave room for the via row, which wraps when the collateral logo joins it
  const node = (id: string, kind: StepKind, x: number, y: number, data: Partial<StepData>): StepNode => ({
    id,
    type: "step",
    position: { x: x * X, y: y * Y },
    draggable: false,
    data: { kind, title: "", lines: [], status: "idle", ...data },
  });
  const nodes: StepNode[] = [
    node("tick", "trigger", 0, 0, { title: "Every 5 minutes", pill: "Trigger", brand: BRAND.portir, via: [BRAND.studio], lines: ["The agent checks your loan"], status: "passed", handles: [h("out", "source", "right"), h("loop", "target", "top")] }),
    node("read", "asset", 1, 0, { title: "Read your stock loan", pill: "Position", brand: stock ?? POOL_BRAND, via: [POOL_BRAND, VENUS_MAINNET, ...(stock ? [stock] : []), BRAND.usdt], lines: ["Debt ÷ liquidation limit,", "live stock prices"], status: "passed", handles: [h("in", "target", "left"), h("out", "source", "right")] }),
    node("check", "guard", 2, 0, { title: `Past ${triggerPct}%?`, pill: "Check", brand: BRAND.portir, via: [{ src: "/mark.svg", name: "Pool oracle" }], lines: [rescued ? `Was ${lastRescue.before.toFixed(1)}% at the last rescue` : "Re-checked on-chain before", rescued ? "" : "any money moves"].filter(Boolean), status: rescued ? "passed" : "waiting", handles: [h("in", "target", "left"), h("down", "source", "bottom"), h("no", "source", "top")] }),
    node("repay", "funding", 2, 1, { title: "Repay from your buffer", pill: "Rescue", brand: BRAND.usdt, via: [BRAND.usdt, POOL_BRAND], lines: [`At most ${cap} per rescue,`, "straight to the pool"], status: rescued ? "passed" : "idle", handles: [h("in", "target", "top"), h("out", "source", "left")] }),
    node("target", "deliver", 1, 1, { title: `Back to ${targetPct}%`, pill: "Result", brand: stock ?? POOL_BRAND, via: [POOL_BRAND], lines: [rescued ? `Now ${lastRescue.after.toFixed(1)}% after ${lastRescue.amount}` : "Just enough, no more"], status: rescued ? "passed" : "idle", handles: [h("in", "target", "right"), h("out", "source", "left")] }),
    node("log", "record", 0, 1, { title: "Recorded on-chain", pill: "Record", brand: BRAND.bscscan, via: [BRAND.bnb, BRAND.bscscan], lines: ["Every rescue in LoanGuard,", "shown below"], status: rescued ? "passed" : "idle", handles: [h("in", "target", "right")] }),
  ];
  const color = (on: boolean, amber = false) => (on ? (amber ? "#ffb040" : "#7ef0b0") : "rgba(255,255,255,0.22)");
  const e = (source: string, target: string, sh: string, th: string, on: boolean, extra: Partial<Edge> = {}): Edge => ({ id: `${source}>${target}`, source, target, sourceHandle: sh, targetHandle: th, type: "smoothstep", animated: on, style: { stroke: color(on, extra.label !== undefined && !rescued), strokeWidth: on ? 2.2 : 1.5 }, ...extra });
  const label = { labelStyle: { fill: "rgba(255,255,255,0.75)", fontSize: 11 }, labelBgStyle: { fill: "#0b111c" }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6 };
  const edges: Edge[] = [
    e("tick", "read", "out", "in", true),
    e("read", "check", "out", "in", true),
    e("check", "repay", "down", "in", rescued, { label: "yes", ...label }),
    e("repay", "target", "out", "in", rescued),
    e("target", "log", "out", "in", rescued),
    e("check", "tick", "no", "loop", !rescued, { label: `below ${triggerPct}%: check again in 5 min`, ...label }),
  ];
  return <FlowCanvas nodes={nodes} edges={edges} className="h-[340px] lg:h-[380px]" padding={0.06} controls={false} />;
}
