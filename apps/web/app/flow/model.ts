/**
 * A plan as the executor runs it, drawn as a flow: every node is a real step in
 * apps/portiragent/app/agent/src/portir/executor.ts, and the last run's outcome lights up where it stopped.
 * Pure functions, no React: `planFlow` builds nodes and edges, `runState` reads a run's reason.
 */
import type { Edge, Node } from "@xyflow/react";

export type Status = "idle" | "passed" | "waiting" | "stopped" | "skipped";
export type StepKind = "trigger" | "asset" | "market" | "guard" | "news" | "funding" | "buy" | "deliver" | "record" | "window" | "skip";

export interface FlowPlan {
  target: string; // ticker or "BASKET:<name>"
  label: string; // display name
  amount: number; // USDT per run
  intervalDays: number;
  smartTiming: boolean;
  once: boolean;
  active: boolean;
}
export interface FlowRun {
  outcome: number; // 0 Bought, 1 Waited, 2 Skipped
  reason: string;
  spreadBps: number;
  at: number;
}
export interface Leg {
  ticker: string;
  weight: number; // 0..1
  icon?: string | null;
}

export interface StepData extends Record<string, unknown> {
  kind: StepKind;
  title: string;
  lines: string[];
  status: Status;
  pill?: string;
  icons?: { ticker: string; icon?: string | null }[];
  /** Logo shown in the icon tile instead of the line icon: the platform doing this step. */
  brand?: Brand;
  /** "via" row: the platforms and tokens this step uses. */
  via?: Brand[];
  editable?: boolean;
  selected?: boolean;
  layout?: "wide" | "tall";
  compact?: boolean;
  /** Explicit connection points (id, type, side) for custom layouts; overrides the per-kind defaults. */
  handles?: { id: string; type: "source" | "target"; side: "left" | "right" | "top" | "bottom" }[];
}
export type StepNode = Node<StepData, "step">;

export interface Brand {
  src: string;
  name: string;
}
export const BRAND = {
  portir: { src: "/mark.svg", name: "Portir" },
  studio: { src: "/logos/bnbchain.svg", name: "BNB Agent Studio" },
  binance: { src: "/logos/binance.svg", name: "Binance RWA data" },
  usdt: { src: "/logos/usdt.png", name: "USDT" },
  bnb: { src: "/logos/bnb.png", name: "BNB Chain" },
  bscscan: { src: "/logos/bscscan.png", name: "BscScan" },
  ondo: { src: "/logos/ondo.png", name: "Ondo" },
  bstocks: { src: "/logos/bstocks.svg", name: "bStocks" },
  xstocks: { src: "/logos/xstocks.png", name: "xStocks" },
  pancakeswap: { src: "/logos/pancakeswap.png", name: "PancakeSwap" },
  venus: { src: "/logos/venus.png", name: "Venus" },
  cake: { src: "/logos/cake.png", name: "CAKE" },
  news: { src: "/logos/news.svg", name: "Yahoo Finance news" },
  llm: { src: "/logos/ai.svg", name: "LLM" },
} satisfies Record<string, Brand>;

/** Which step the last run stopped at, and how. */
export interface RunState {
  at: StepKind | "done" | null;
  status: Status;
  note: string;
}

const MARKET = /market is (closed|in pre-market|in after-hours)/i;

export function runState(run: FlowRun | undefined, plan?: Pick<FlowPlan, "smartTiming">): RunState {
  if (!run) return { at: null, status: "idle", note: "No run yet. The agent checks every 15 minutes once the plan is due." };
  const r = run.reason;
  if (run.outcome === 0) return { at: "done", status: "passed", note: r };
  if (run.outcome === 2) {
    if (/^No fair moment/.test(r)) return { at: "window", status: "stopped", note: r };
    return { at: "record", status: "skipped", note: r };
  }
  if (/holding back for the news/.test(r)) return { at: "news", status: "waiting", note: r };
  if (/^Ready to buy, but/.test(r)) return { at: "funding", status: "waiting", note: r };
  if (/^Buy failed/.test(r)) return { at: "buy", status: "stopped", note: r };
  if (/waiting for the open/.test(r) || (plan?.smartTiming !== false && MARKET.test(r) && !/above the exchange price, so it is better to wait/.test(r))) {
    return { at: "market", status: "waiting", note: r };
  }
  // Guard: a BLOCK ("better to wait", "paused") is red, a WARN is amber.
  const blocked = /better to wait|Trading is paused/.test(r) || run.spreadBps > 100;
  return { at: "guard", status: blocked ? "stopped" : "waiting", note: r };
}

export type Layout = "wide" | "tall";

const cadence = (days: number) => (days === 7 ? "Every week" : days === 14 ? "Every 2 weeks" : days === 30 ? "Every month" : `Every ${days} days`);
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const LABEL = { labelStyle: { fill: "rgba(255,255,255,0.75)", fontSize: 11 }, labelBgStyle: { fill: "#0b111c" }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6 };

/**
 * Nodes and edges for a plan. "wide": decide on the top row (trigger → checks → funds), act on the bottom row
 * (buy → deliver → record), the wait/skip branch above. "tall": one column for phones, the branch beside it.
 */
export function planFlow(
  plan: FlowPlan,
  lastRun: FlowRun | undefined,
  legs: Leg[],
  opts: { selected?: StepKind | null; editable?: boolean; layout?: Layout } = {},
): { nodes: StepNode[]; edges: Edge[] } {
  const layout = opts.layout ?? "wide";
  const state = runState(lastRun, plan);
  const main: StepKind[] = ["trigger", "asset", ...(plan.smartTiming ? (["market"] as const) : []), "guard", "news", "funding", "buy", "deliver", "record"];
  const stopIdx = state.at === "done" ? main.length : state.at ? main.indexOf(state.at as StepKind) : -1;
  const branchStop = state.at === "window" || state.at === "record";
  const failIdx = branchStop ? main.indexOf(plan.smartTiming ? "market" : "guard") : -1;
  const statusOf = (k: StepKind): Status => {
    const i = main.indexOf(k);
    if (state.at === null) return "idle";
    if (state.at === "done") return "passed";
    if (branchStop) return i < failIdx ? "passed" : i === failIdx ? "waiting" : "idle";
    if (i < stopIdx) return "passed";
    if (i === stopIdx) return state.status;
    return "idle";
  };

  const basket = legs.length > 1;
  const spread = lastRun && lastRun.spreadBps !== 0 ? `${lastRun.spreadBps > 0 ? "+" : ""}${(lastRun.spreadBps / 100).toFixed(2)}% at the last check` : "Checked on every run";
  const info: Record<StepKind, { title: string; lines: string[]; pill: string; editable?: boolean; brand?: Brand; via?: Brand[] }> = {
    trigger: { title: plan.once ? "Once, when fair" : cadence(plan.intervalDays), lines: [plan.once ? "Watches for up to 7 days" : "Checked every 15 min when due"], pill: "Trigger", editable: true, brand: BRAND.portir, via: [BRAND.studio] },
    asset: { title: plan.label, lines: [`${money(plan.amount)} ${plan.once ? "one time" : "per run"}`, basket ? `${legs.length} holdings, fixed weights` : plan.target], pill: basket ? "Basket" : "Stock", editable: true },
    market: { title: "NYSE open?", lines: ["Smart timing: regular", "session only"], pill: "Check", editable: true, brand: BRAND.binance, via: [BRAND.binance] },
    guard: { title: "Fair price?", lines: ["Waits if >1% above the exchange", spread], pill: "Guard", brand: BRAND.portir, via: [BRAND.binance] },
    news: { title: "News check", lines: ["AI reads the latest headlines,", "may hold back for real risk"], pill: "AI", brand: BRAND.llm, via: [BRAND.news, BRAND.llm] },
    funding: { title: "From your wallet", lines: ["Via PlanRegistry,", `max ${money(plan.amount)} per run`], pill: "Funds", brand: BRAND.usdt, via: [BRAND.usdt, BRAND.bnb] },
    buy: { title: "Buy", lines: ["Best issuer, live price"], pill: "Swap", brand: BRAND.pancakeswap, via: [BRAND.ondo, BRAND.bstocks, BRAND.xstocks] },
    deliver: { title: "Shares to your wallet", lines: ["Unspent money comes back"], pill: "Deliver", brand: BRAND.bnb, via: [BRAND.bnb] },
    record: { title: "Reason on BSC", lines: ["One sentence per run,", "public on PlanRegistry"], pill: "Record", brand: BRAND.bscscan, via: [BRAND.bscscan] },
    window: { title: plan.once ? "Within 7 days?" : "Within 48 hours?", lines: ["Yes: check again in 15 min", "No: skip this run"], pill: "Wait" },
    skip: { title: "Skip this run", lines: [plan.once ? "The order ends" : "Next run stays on schedule"], pill: "Skip" },
  };

  // Grid positions.
  const W = 230, R = 175;
  const decide = main.slice(0, main.indexOf("funding") + 1);
  const col = (k: StepKind) => decide.indexOf(k);
  const legGap = 74;
  const nodes: StepNode[] = [];
  const edges: Edge[] = [];
  const add = (id: string, kind: StepKind, x: number, y: number, status: Status, extra: Partial<StepData> = {}) => {
    const i = info[kind];
    nodes.push({ id, type: "step", position: { x, y }, draggable: false, data: { kind, title: i.title, lines: i.lines, pill: i.pill, brand: i.brand, via: i.via, status, layout, editable: opts.editable && i.editable, selected: opts.selected === kind, ...extra } });
  };
  const buyIds = basket ? legs.map((l) => `buy-${l.ticker}`) : ["buy"];
  const addBuy = (pos: (i: number) => { x: number; y: number }) =>
    basket
      ? legs.forEach((l, i) => add(`buy-${l.ticker}`, "buy", pos(i).x, pos(i).y, statusOf("buy"), { title: `Buy ${l.ticker}`, lines: [`${Math.round(l.weight * 100)}% · ${money(plan.amount * l.weight)}`], icons: [{ ticker: l.ticker, icon: l.icon }], compact: true }))
      : add("buy", "buy", pos(0).x, pos(0).y, statusOf("buy"));
  const icons = legs.map((l) => ({ ticker: l.ticker, icon: l.icon }));

  if (layout === "wide") {
    decide.forEach((k, i) => add(k, k, i * (W + 30), 0, statusOf(k), k === "asset" ? { icons } : {}));
    const bottom = R + 30 + (basket ? ((legs.length - 1) * legGap) / 2 : 0);
    const buyX = (col("funding") - 2) * (W + 30);
    addBuy((i) => ({ x: buyX, y: bottom + (i - (legs.length - 1) / 2) * (basket ? legGap : 0) }));
    add("deliver", "deliver", buyX + (W + 30), bottom, statusOf("deliver"));
    add("record", "record", buyX + 2 * (W + 30), bottom, statusOf("record"));
    add("window", "window", (col("guard") - 0.5) * (W + 30), -R, "idle");
    add("skip", "skip", col("funding") * (W + 30), -R, "idle");
  } else {
    const step = 150;
    // The asset card carries a row of logos, so it is taller than the others.
    const ys: number[] = [];
    decide.reduce((y, k) => (ys.push(y), y + (k === "asset" ? 185 : step)), 0);
    decide.forEach((k, i) => add(k, k, 0, ys[i], statusOf(k), k === "asset" ? { icons } : {}));
    const top = ys[ys.length - 1] + step;
    const rows = basket ? legs.length : 1;
    addBuy((i) => (basket ? { x: 0, y: top + i * legGap } : { x: 0, y: top }));
    add("deliver", "deliver", 0, top + rows * (basket ? legGap : step) + 30, statusOf("deliver"));
    add("record", "record", 0, top + rows * (basket ? legGap : step) + 30 + step, statusOf("record"));
    add("window", "window", 290, ys[col("guard")] - 20, "idle");
    add("skip", "skip", 290, ys[col("funding")] + 60, "idle");
  }

  // Edges.
  const edgeColor = (s: Status) => (s === "passed" ? "#7ef0b0" : s === "waiting" ? "#ffb040" : s === "stopped" ? "#ff6b6b" : "rgba(255,255,255,0.22)");
  const link = (source: string, target: string, flowing: Status, extra: Partial<Edge> = {}) =>
    edges.push({ id: `${source}>${target}>${extra.sourceHandle ?? "out"}`, source, target, type: "smoothstep", sourceHandle: "out", targetHandle: "in", animated: flowing === "passed" || flowing === "waiting", style: { stroke: edgeColor(flowing), strokeWidth: flowing === "idle" ? 1.5 : 2.2 }, ...extra });
  const between = (a: StepKind, b: StepKind): Status => {
    const sa = statusOf(a), sb = statusOf(b);
    return sa === "passed" && sb !== "idle" ? sb : "idle";
  };
  for (let i = 0; i < main.length - 1; i++) {
    const a = main[i], b = main[i + 1];
    const srcs = a === "buy" ? buyIds : [a];
    const dsts = b === "buy" ? buyIds : [b];
    for (const sId of srcs) for (const dId of dsts) link(sId, dId, between(a, b), a === "funding" ? { sourceHandle: "down" } : {});
  }
  const waitingHere = state.status === "waiting" && (state.at === "market" || state.at === "guard" || state.at === "news" || state.at === "funding");
  const windowStatus: Status = state.at === "window" ? "stopped" : waitingHere ? "waiting" : "idle";
  nodes.find((n) => n.id === "window")!.data.status = windowStatus;
  nodes.find((n) => n.id === "skip")!.data.status = state.at === "window" ? "stopped" : "idle";
  const checkNode = plan.smartTiming ? "market" : "guard";
  const into = (from: StepKind, label: string) => {
    const here = state.at === from && (state.status === "waiting" || state.status === "stopped");
    link(from, "window", here ? (state.at === "window" ? "stopped" : "waiting") : branchStop && from === checkNode ? "stopped" : "idle", { sourceHandle: "no", targetHandle: "from", label, ...LABEL });
  };
  if (plan.smartTiming) into("market", "closed");
  into("guard", "not fair");
  into("news", "news risk");
  into("funding", "short");
  link("window", "trigger", windowStatus === "waiting" ? "waiting" : "idle", { sourceHandle: "retry", targetHandle: "loop", label: "check again in 15 min", ...LABEL });
  link("window", "skip", state.at === "window" ? "stopped" : "idle", { sourceHandle: "skip", label: "past window", ...LABEL });
  link("skip", "record", state.at === "window" ? "stopped" : "idle", { targetHandle: "side" });
  return { nodes, edges };
}
