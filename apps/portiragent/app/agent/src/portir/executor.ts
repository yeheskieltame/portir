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
 * Sell rules (take-profit / stop-loss) are one-time plans: when the stock's
 * price crosses the trigger during market hours, the agent pulls the shares
 * through PlanRegistry, sells them and sends the proceeds to the owner.
 *
 * Price and session decisions are deterministic (@portir/core thresholds).
 * Before a buy the LLM reads the news and may only say "wait" (judge.ts).
 * Signing is fixed code in registry.ts. Every recorded outcome is also sent
 * to the owner's Telegram when linked (notify.ts).
 */
import { type Address, formatUnits, type Hex } from "viem";
import { guard, isSuspectDiscount } from "@portir/core";
import { targetLegs } from "@portir/core/catalog";
import * as aw from "./agenticWallet.js";
import { newsCheck } from "./judge.js";
import { assess } from "./market.js";
import { notify } from "./notify.js";
import { OUTCOME, type Plan, type SellRule, decodeTarget, getPlan, planCount, recordRun, runsOf, sellRuleOf } from "./registry.js";

const SMART_WINDOW = 48 * 3600;
const ONCE_WINDOW = 7 * 24 * 3600; // a one-time "buy when fair" order waits up to a week
const WAIT_LOG_HOURS = Number(process.env.PORTIR_WAIT_LOG_HOURS ?? 6);
const log = (msg: string) => console.log(`[portir.executor] ${msg}`);

/**
 * Execution backend. `off` (default) records the decision but does not buy:
 * the plan is Skipped with an honest reason so the user knows. Other backends
 * (Agentic Wallet session, Trading API + agent wallet) plug in here.
 */
type Execute = (amount: number, ticker: string, owner: Address) => Promise<{ txHash: Hex; note: string }>;

/**
 * `agentic-wallet` (mainnet): the run's money is already in the operator's Binance Agentic Wallet (pulled through
 * PlanRegistry, then forwarded). Quote, re-run the Guard on the executable price, swap, and send the shares to the
 * owner. The wallet's own daily limit and token scope bound what this can do.
 */
const viaAgenticWallet: Execute = async (amount, ticker, owner) => {
  const a = await assess(ticker);
  const offer = a.view.offers.find((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps)));
  if (!offer) throw new Error("no tradable issuer");
  const q = await aw.quote(offer.contractAddress, amount);
  const pricePerShare = amount / (q.tokensOut * offer.multiplier);
  if (a.view.reference !== null) {
    const d = guard({ session: a.view.session ?? "closed", onchain: pricePerShare, reference: a.view.reference });
    if (d.verdict === "BLOCK") throw new Error(`executable price failed the Guard: ${d.reason}`);
  }
  const { txHash } = await aw.swap(offer.contractAddress, amount);
  // ponytail: "max" of this token is this order's output because runs execute one at a time; per-order amounts if that changes.
  await aw.send(offer.contractAddress, owner, "max");
  return { txHash: (txHash || `0x${"0".repeat(64)}`) as Hex, note: `Bought ≈${(q.tokensOut * offer.multiplier).toFixed(4)} shares from ${offer.issuer} at $${pricePerShare.toFixed(2)} via Agentic Wallet, sent to your wallet.` };
};

/** `testnet`: same live price and Guard as mainnet; the owner's tUSDT buys on the TestExchange and the shares go to the owner. */
const viaTestnet: Execute = async (amount, ticker, owner) => {
  const { testnetFeeBps, buyOnTestnet } = await import("./testnet.js");
  const a = await assess(ticker);
  const offer = a.view.offers.find((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps)));
  if (!offer) throw new Error("no tradable issuer");
  const price = offer.onchain;
  const feeBps = await testnetFeeBps();
  const shares = (amount * (10_000 - feeBps)) / 10_000 / price;
  const { txHash, shares: got } = await buyOnTestnet(owner, ticker, amount, price, shares * 0.995);
  return { txHash, note: `Bought ${got.toFixed(4)} shares at $${price.toFixed(2)} (${offer.issuer} price) into your wallet.` };
};

/**
 * Safety rules, checked on every execution:
 *  - the backend must live on the same chain as the registry (a testnet plan can never spend mainnet money);
 *  - mainnet backends also need PORTIR_MAINNET_ARMED=yes, set deliberately after the checklist in contracts/AUDIT.md.
 */
function backend(): "off" | "testnet" | "agentic-wallet" {
  const mode = process.env.PORTIR_EXECUTION ?? "off";
  const registryChain = process.env.PORTIR_REGISTRY_CHAIN === "mainnet" ? "mainnet" : "testnet";
  if (mode === "testnet" && registryChain === "testnet") return "testnet";
  if (mode === "agentic-wallet" && registryChain === "mainnet" && process.env.PORTIR_MAINNET_ARMED === "yes") return "agentic-wallet";
  if (mode !== "off") log(`execution "${mode}" refused: registry is on ${registryChain}${registryChain === "mainnet" && process.env.PORTIR_MAINNET_ARMED !== "yes" ? " and PORTIR_MAINNET_ARMED is not set" : ""}`);
  return "off";
}
const execute: Execute = async (amount, ticker, owner) => {
  const mode = backend();
  if (mode === "agentic-wallet") return viaAgenticWallet(amount, ticker, owner);
  if (mode === "testnet") return viaTestnet(amount, ticker, owner);
  throw new Error("execution is not enabled on this agent (PORTIR_EXECUTION=off)");
};
const executionEnabled = () => backend() !== "off";

export async function scanOnce(): Promise<void> {
  const n = await planCount();
  // Only plans that name this agent as executor: anything else would revert on-chain anyway.
  const me = ((await import("@bnbagent/studio-runtime/wallet")).getWallet().address as string).toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const due: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i);
    try {
      const plan = await getPlan(id);
      if (!plan.active || plan.nextRunAt > now || plan.executor.toLowerCase() !== me) continue;
      due.push(i);
      const rule = await sellRuleOf(id);
      await (rule ? runSell(id, plan, rule) : runPlan(id, plan, now));
    } catch (e) {
      log(`plan ${i}: ${e instanceof Error ? e.message : e}`);
    }
  }
  log(`scan: ${n} plans, ${due.length ? `due ${due.map((i) => `#${i}`).join(" ")}` : "none due"}`);
}

async function runPlan(id: bigint, plan: Plan, now: number): Promise<void> {
  const target = decodeTarget(plan.target);
  const runs = await runsOf(id);
  const last = runs[runs.length - 1];
  const legs = targetLegs(target);
  if (!legs) {
    await record(plan.owner, id, "Skipped", 0, `Unknown target ${target}.`, last);
    return;
  }
  const overdue = now - plan.nextRunAt;
  const basket = legs.length > 1;

  // A basket is judged by its worst leg: one blocked holding holds the whole order.
  const legViews = await Promise.all(legs.map(async (l) => ({ ...l, a: await assess(l.ticker) })));
  const rank = { GO: 0, WARN: 1, BLOCK: 2 } as const;
  const worst = legViews.reduce((w, l) => (rank[l.a.decision?.verdict ?? "BLOCK"] > rank[w.a.decision?.verdict ?? "BLOCK"] ? l : w), legViews[0]);
  const verdict = worst.a.decision?.verdict ?? "BLOCK";
  const spread = Math.max(...legViews.map((l) => l.a.decision?.spreadBps ?? 0));
  const reason = basket ? `${worst.ticker}: ${worst.a.reason}` : worst.a.reason;
  const session = worst.a.view.session ?? "closed";

  // Smart timing wants the exchange open AND a green price; the plain schedule only refuses a BLOCK.
  const open = legViews.every((l) => l.a.view.session === "open");
  const fairEnough = plan.smartTiming ? verdict === "GO" && open : verdict !== "BLOCK";
  const windowOver = overdue > (plan.once ? ONCE_WINDOW : SMART_WINDOW);

  if (fairEnough || (plan.smartTiming && windowOver && verdict === "WARN")) {
    if (!executionEnabled()) {
      await record(plan.owner, id, "Skipped", spread, `Would buy now (${reason}) but execution is not enabled on this agent yet.`, last);
      return;
    }
    // The LLM reads the headlines and may hold the buy back; past the window the schedule wins.
    const nc = await newsCheck(legs.map((l) => l.ticker));
    if (nc?.wait && !windowOver) {
      await record(plan.owner, id, "Waited", spread, `Price is fair, but holding back for the news: ${nc.reason}`, last);
      return;
    }
    const total = Number(formatUnits(plan.amount, 18));
    const bought: string[] = [];
    const failed: string[] = [];
    let txHash: Hex | undefined;
    // The owner's money moves through PlanRegistry, which caps it at the plan amount for this run.
    // Mainnet: it is then forwarded to the Agentic Wallet, which swaps and sends the shares to the owner.
    const fd = await import("./funding.js");
    const problem = await fd.fundingProblem(plan.owner, total);
    if (problem) {
      await record(plan.owner, id, "Waited", spread, `Ready to buy, but: ${problem}`, last);
      return;
    }
    await fd.pullFunds(id, total);
    let unspent = total;
    const awAddress = backend() === "agentic-wallet" ? ((await aw.bscAddress()) as Address) : null;
    if (awAddress) await fd.forward(awAddress, total);
    // One guarded swap per leg, in sequence. A failed leg is reported, not retried next tick (that would double-buy the others).
    for (const l of legs) {
      const slice = Math.floor(total * l.weight * 100) / 100;
      if (slice < 1) {
        failed.push(`${l.ticker}: slice below $1`);
        continue;
      }
      try {
        const r = await execute(slice, l.ticker, plan.owner);
        txHash ??= r.txHash;
        unspent -= slice;
        bought.push(basket ? `${l.ticker} ${r.note}` : r.note);
      } catch (e) {
        failed.push(`${l.ticker}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (unspent >= 0.01) {
      const back = Math.floor(unspent * 100) / 100;
      try {
        if (awAddress) await aw.send(aw.USDT, await fd.agentAddress(), back);
        await fd.returnFunds(id, back);
      } catch (e) {
        log(`plan ${id}: could not return $${unspent.toFixed(2)} unspent: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (bought.length === 0) {
      await record(plan.owner, id, "Waited", spread, `Buy failed: ${failed.join("; ")}`, last);
      return;
    }
    const note = basket ? `Bought ${bought.length}/${legs.length} holdings.${failed.length ? ` Failed: ${failed.join("; ")}.` : ""}` : bought[0];
    await record(plan.owner, id, "Executed", spread, `${reason} ${note}${nc ? ` News checked: ${nc.reason}` : ""}`.trim(), last, txHash);
    return;
  }
  if (windowOver) {
    await record(plan.owner, id, "Skipped", spread, `No fair moment in ${plan.once ? "7 days" : "48 hours"}. ${reason}`, last);
    return;
  }
  const SESSION: Record<string, string> = { pre: "in pre-market", after: "in after-hours", closed: "closed" };
  await record(plan.owner, id, "Waited", spread, plan.smartTiming && !open && verdict === "GO" ? `The market is ${SESSION[session] ?? "closed"} and the price is fair; waiting for the open.` : reason, last);
}

/** A sell rule: watch the stock's real price; once it crosses the trigger in market hours, sell the shares for the owner. */
async function runSell(id: bigint, plan: Plan, rule: SellRule): Promise<void> {
  const ticker = decodeTarget(plan.target);
  const trigger = Number(rule.triggerPrice) / 1e18;
  const kind = rule.below ? "stop-loss" : "take-profit";
  const runs = await runsOf(id);
  const last = runs[runs.length - 1];
  const a = await assess(ticker);
  const ref = a.view.reference;
  if (ref === null) return log(`sell #${id} ${ticker}: no price right now`);
  const hit = rule.below ? ref <= trigger : ref >= trigger;
  if (!hit) return log(`sell #${id} ${ticker}: $${ref.toFixed(2)}, ${kind} at $${trigger.toFixed(2)}; watching`);
  if (a.view.session !== "open") return log(`sell #${id} ${ticker}: $${ref.toFixed(2)} crossed the ${kind}, waiting for the market to open`);
  if (backend() !== "testnet") return log(`sell #${id} ${ticker}: trigger hit, but selling runs on testnet only for now`);

  const tn = await import("./testnet.js");
  const offer = a.view.offers.find((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps)));
  if (!offer) return log(`sell #${id} ${ticker}: no fair on-chain price to sell at`);
  const problem = await tn.sharesProblem(plan.owner, rule.token, plan.amount);
  if (problem) {
    await record(plan.owner, id, "Waited", 0, `${ticker} hit your ${kind} at $${trigger.toFixed(2)}, but: ${problem}`, last);
    return;
  }
  await tn.pullShares(id, plan.amount);
  try {
    const { txHash, usdt } = await tn.sellOnTestnet(plan.owner, ticker, plan.amount, offer.onchain);
    const shares = Number(plan.amount) / 1e18;
    await record(plan.owner, id, "Executed", offer.spreadBps ?? 0, `${ticker} at $${ref.toFixed(2)} crossed your ${kind} ($${trigger.toFixed(2)}). Sold ${shares.toFixed(4)} shares at $${offer.onchain.toFixed(2)} for $${usdt.toFixed(2)}.`, last, txHash);
  } catch (e) {
    await tn.returnShares(id, rule.token, plan.amount).catch((r) => log(`sell #${id}: could not return shares: ${r instanceof Error ? r.message : r}`));
    await record(plan.owner, id, "Waited", 0, `Sell failed, shares returned: ${e instanceof Error ? e.message.slice(0, 120) : e}`, last);
  }
}

const EXPLORER = () => (process.env.PORTIR_REGISTRY_CHAIN === "mainnet" ? "https://bscscan.com" : "https://testnet.bscscan.com");
const EMOJI = { Executed: "✅", Waited: "⏸", Skipped: "⏭" } as const;

async function record(owner: Address, id: bigint, outcome: keyof typeof OUTCOME, spread: number, reason: string, last: { at: number; outcome: number } | undefined, txHash?: Hex) {
  // A Waited entry costs gas and does not advance the schedule: log it sparingly.
  if (outcome === "Waited" && last?.outcome === OUTCOME.Waited && Date.now() / 1000 - last.at < WAIT_LOG_HOURS * 3600) {
    log(`plan ${id} still waiting (logged on-chain at most every ${WAIT_LOG_HOURS}h): ${reason}`);
    return;
  }
  const hash = await recordRun(id, outcome, spread, txHash ?? (`0x${"0".repeat(64)}` as Hex), reason);
  log(`plan ${id} ${outcome} (${spread} bps): ${reason} [${hash}]`);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  await notify(owner, `${EMOJI[outcome]} <b>Plan #${id} · ${outcome}</b>\n${esc(reason)}${txHash ? `\n<a href="${EXPLORER()}/tx/${txHash}">Trade</a> · ` : "\n"}<a href="${EXPLORER()}/tx/${hash}">Record</a>`);
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
