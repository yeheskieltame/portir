/**
 * The DCA executor: the part of Portir that runs while the user sleeps.
 *
 * Every `PORTIR_SCAN_SECONDS` it scans PlanRegistry for active plans that are
 * due, runs the Guard on live market data and records the outcome on-chain
 * with a one-sentence reason (the app shows it in the plan's history):
 *
 *   Executed  — bought (needs an execution backend, see `execute`)
 *   Waited    — smart timing: the market is closed or the price is not fair;
 *               try again later, at most once every WAIT_LOG_HOURS
 *   Skipped   — the plan's window (48h after due) passed without a fair
 *               moment, or trading is halted, or execution is not enabled
 *
 * Decisions are deterministic (@portir/core thresholds). The LLM is not in
 * this loop. Signing is fixed code in registry.ts.
 */
import { type Hex } from "viem";
import { assess } from "./market.js";
import { OUTCOME, type Plan, decodeTarget, getPlan, planCount, recordRun, runsOf } from "./registry.js";

const SMART_WINDOW = 48 * 3600;
const WAIT_LOG_HOURS = Number(process.env.PORTIR_WAIT_LOG_HOURS ?? 6);
const log = (msg: string) => console.log(`[portir.executor] ${msg}`);

/**
 * Execution backend. `off` (default) records the decision but does not buy:
 * the plan is Skipped with an honest reason so the user knows. Other backends
 * (Agentic Wallet session, Trading API + agent wallet) plug in here.
 */
type Execute = (plan: Plan, ticker: string) => Promise<{ txHash: Hex; note: string }>;
const execute: Execute = async () => {
  throw new Error("execution is not enabled on this agent (PORTIR_EXECUTION=off)");
};
const executionEnabled = () => (process.env.PORTIR_EXECUTION ?? "off") !== "off";

export async function scanOnce(): Promise<void> {
  const n = await planCount();
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < n; i++) {
    const id = BigInt(i);
    try {
      const plan = await getPlan(id);
      if (!plan.active || plan.nextRunAt > now) continue;
      await runPlan(id, plan, now);
    } catch (e) {
      log(`plan ${i}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function runPlan(id: bigint, plan: Plan, now: number): Promise<void> {
  const target = decodeTarget(plan.target);
  if (target.startsWith("BASKET:")) {
    // ponytail: baskets need one guarded swap per leg; single stocks first.
    return;
  }
  const runs = await runsOf(id);
  const last = runs[runs.length - 1];
  const overdue = now - plan.nextRunAt;
  const a = await assess(target);
  const verdict = a.decision?.verdict ?? "BLOCK";
  const spread = a.decision?.spreadBps ?? 0;

  // Smart timing wants the exchange open AND a green price; the plain schedule only refuses a BLOCK.
  const open = a.view.session === "open";
  const fairEnough = plan.smartTiming ? verdict === "GO" && open : verdict !== "BLOCK";
  const windowOver = overdue > SMART_WINDOW;

  if (fairEnough || (plan.smartTiming && windowOver && verdict === "WARN")) {
    if (!executionEnabled()) {
      await record(id, "Skipped", spread, `Would buy now (${a.reason}) but execution is not enabled on this agent yet.`, last);
      return;
    }
    try {
      const { txHash, note } = await execute(plan, target);
      await record(id, "Executed", spread, `${a.reason} ${note}`.trim(), last, txHash);
    } catch (e) {
      await record(id, "Waited", spread, `Buy failed: ${e instanceof Error ? e.message : e}`, last);
    }
    return;
  }
  if (windowOver) {
    await record(id, "Skipped", spread, `No fair moment in 48 hours. ${a.reason}`, last);
    return;
  }
  const SESSION: Record<string, string> = { pre: "in pre-market", after: "in after-hours", closed: "closed" };
  await record(id, "Waited", spread, plan.smartTiming && !open && verdict === "GO" ? `The market is ${SESSION[a.view.session ?? "closed"] ?? "closed"} and the price is fair; waiting for the open.` : a.reason, last);
}

async function record(id: bigint, outcome: keyof typeof OUTCOME, spread: number, reason: string, last: { at: number; outcome: number } | undefined, txHash?: Hex) {
  // A Waited entry costs gas and does not advance the schedule: log it sparingly.
  if (outcome === "Waited" && last?.outcome === OUTCOME.Waited && Date.now() / 1000 - last.at < WAIT_LOG_HOURS * 3600) return;
  const hash = await recordRun(id, outcome, spread, txHash ?? (`0x${"0".repeat(64)}` as Hex), reason);
  log(`plan ${id} ${outcome} (${spread} bps): ${reason} [${hash}]`);
}

/** Start the loop; returns a stop function. */
export function startDcaLoop(): () => void {
  const every = Number(process.env.PORTIR_SCAN_SECONDS ?? 900) * 1000;
  if (!process.env.PORTIR_REGISTRY) {
    log("PORTIR_REGISTRY not set; executor idle");
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await scanOnce();
    } catch (e) {
      log(`scan failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  log(`scanning ${process.env.PORTIR_REGISTRY} every ${every / 1000}s (execution ${executionEnabled() ? "on" : "off"})`);
  void tick();
  const timer = setInterval(tick, every);
  return () => clearInterval(timer);
}
