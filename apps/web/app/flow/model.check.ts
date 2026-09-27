import assert from "node:assert/strict";
import { planFlow, runState } from "./model";
const plan = { target: "NVDA", label: "NVIDIA", amount: 10, intervalDays: 7, smartTiming: true, once: false, active: true };
const run = (outcome: number, reason: string, spreadBps = 0) => ({ outcome, reason, spreadBps, at: 1 });
const cases: [ReturnType<typeof run> | undefined, string, string][] = [
  [undefined, "null", "idle"],
  [run(0, "The market is open and the price is fair (+0.05% above the exchange price). Bought 0.02 shares"), "done", "passed"],
  [run(1, "The market is in after-hours and the price is fair; waiting for the open."), "market", "waiting"],
  [run(1, "The market is closed and the price is fair; waiting for the open."), "market", "waiting"],
  [run(1, "Ready to buy, but: Plans may spend $0.00 of your tUSDT, the order needs $2.00. Allow it on the Plans page."), "funding", "waiting"],
  [run(1, "The market is open and the on-chain price is +1.40% above the exchange price, so it is better to wait.", 140), "guard", "stopped"],
  [run(1, "The market is open and you would pay +0.70% more than the exchange price.", 70), "guard", "waiting"],
  [run(1, "Buy failed: NVDA: slice below $1"), "buy", "stopped"],
  [run(2, "No fair moment in 48 hours. The market is closed and ..."), "window", "stopped"],
  [run(2, "Unknown target FOO."), "record", "skipped"],
];
for (const [r, at, status] of cases) {
  const s = runState(r, plan);
  assert.equal(String(s.at), at, r?.reason);
  assert.equal(s.status, status, r?.reason);
}
const byId = (f: ReturnType<typeof planFlow>, id: string) => f.nodes.find((n) => n.id === id)!.data.status;
let f = planFlow(plan, cases[2][0], [{ ticker: "NVDA", weight: 1 }]);
assert.equal(byId(f, "trigger"), "passed"); assert.equal(byId(f, "market"), "waiting"); assert.equal(byId(f, "guard"), "idle"); assert.equal(byId(f, "window"), "waiting");
f = planFlow(plan, cases[4][0], [{ ticker: "NVDA", weight: 1 }]);
assert.equal(byId(f, "guard"), "passed"); assert.equal(byId(f, "funding"), "waiting"); assert.equal(byId(f, "buy"), "idle");
f = planFlow({ ...plan, smartTiming: false }, cases[1][0], [{ ticker: "A", weight: 0.5 }, { ticker: "B", weight: 0.5 }]);
assert.ok(!f.nodes.some((n) => n.id === "market")); assert.equal(byId(f, "buy-A"), "passed"); assert.equal(byId(f, "record"), "passed");
f = planFlow(plan, cases[8][0], [{ ticker: "NVDA", weight: 1 }]);
assert.equal(byId(f, "window"), "stopped"); assert.equal(byId(f, "skip"), "stopped"); assert.equal(byId(f, "funding"), "idle");
const ids = f.edges.map((e) => e.id); assert.equal(new Set(ids).size, ids.length, "edge ids unique");
for (const e of f.edges) { assert.ok(f.nodes.some((n) => n.id === e.source) && f.nodes.some((n) => n.id === e.target), `dangling edge ${e.id}`); }
console.log("flow model ok:", cases.length, "run cases + layout checks");
