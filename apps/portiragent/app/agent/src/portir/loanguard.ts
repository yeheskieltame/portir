/**
 * Loan Guard: keeps borrowers of tokenized-stock loans out of liquidation. On testnet the loans live in
 * StockLendingPool (Venus-compatible, MockStock collateral, tUSDT debt; Venus has no stock markets on testnet);
 * on mainnet the same LoanGuard points at Venus, which lists TSLAB/NVDAB. Borrowers set a guard on the LoanGuard contract and
 * approve it for their safety buffer (the debt token). Every PORTIR_GUARD_SECONDS this agent reads each guarded
 * position and, past the borrower's trigger, repays just enough (capped) to bring it back to the target.
 * The contract re-checks the position on-chain and pays Venus straight from the borrower; nothing passes here.
 */
import { type Address, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import pool from "../../../../../../contracts/deployments/stockpool-testnet.json" with { type: "json" };
import { assess } from "./market.js";
import { client, sendTx } from "./registry.js";

/** The stock pool is its own oracle (Venus: comptroller.oracle()). */
export const VENUS = { comptroller: pool.pool, oracle: pool.pool, vUSDT: pool.vUSDT, USDT: pool.USDT, loanGuard: pool.loanGuard } as Record<"comptroller" | "oracle" | "vUSDT" | "USDT" | "loanGuard", Address>;
const MARKETS = pool.markets as Record<string, Address>;
const poolAbi = parseAbi(["function setPrices(address[] vTokens, uint128[] prices)"]);

export const loanGuardAbi = parseAbi([
  "struct Guard { address executor; address vToken; uint16 triggerBps; uint16 targetBps; uint128 maxPerRescue; uint32 cooldown; uint40 lastRescueAt; bool active; }",
  "struct Rescue { uint40 at; uint128 amount; uint16 usedBpsBefore; uint16 usedBpsAfter; }",
  "function borrowers() view returns (address[])",
  "function guardOf(address) view returns (Guard)",
  "function position(address) view returns (uint256 debtUsd, uint256 limitUsd)",
  "function usedBps(address) view returns (uint256)",
  "function rescuesOf(address) view returns (Rescue[])",
  "function rescue(address borrower, uint256 amount)",
]);
const vTokenAbi = parseAbi(["function underlying() view returns (address)"]);
const oracleAbi = parseAbi(["function getUnderlyingPrice(address) view returns (uint256)"]);

const log = (msg: string) => console.log(`[portir.guard] ${msg}`);
const pct = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(1)}%`;
const read = <T>(functionName: string, args: unknown[] = []) =>
  client().readContract({ address: VENUS.loanGuard, abi: loanGuardAbi, functionName, args } as never) as Promise<T>;

type Guard = { executor: Address; vToken: Address; triggerBps: number; targetBps: number; maxPerRescue: bigint; cooldown: number; lastRescueAt: number; active: boolean };

/** Everything the app and MCP need about one borrower's Venus loan and guard. */
export async function loanHealth(borrower: Address) {
  const [[debtUsd, limitUsd], usedBps, guard, rescues] = await Promise.all([
    read<readonly [bigint, bigint]>("position", [borrower]),
    read<bigint>("usedBps", [borrower]),
    read<Guard>("guardOf", [borrower]),
    read<readonly { at: number; amount: bigint; usedBpsBefore: number; usedBpsAfter: number }[]>("rescuesOf", [borrower]),
  ]);
  return { borrower, debtUsd: Number(debtUsd) / 1e18, limitUsd: Number(limitUsd) / 1e18, usedBps: Number(usedBps > 100_000n ? 100_000n : usedBps), guard: guard.active ? guard : null, rescues: rescues.length, lastRescue: rescues.at(-1) ?? null };
}

/** How much debt token brings `borrower` back to the guard's target, before caps. */
async function repayToTarget(borrower: Address, g: Guard): Promise<bigint> {
  const [debtUsd, limitUsd] = await read<readonly [bigint, bigint]>("position", [borrower]);
  const targetDebt = (limitUsd * BigInt(g.targetBps)) / 10_000n;
  if (debtUsd <= targetDebt) return 0n;
  const price = await client().readContract({ address: VENUS.oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [g.vToken] }); // 1e(36-decimals)
  return ((debtUsd - targetDebt) * 10n ** 18n) / price + 1n;
}

/** Keeper: mirror every stock market's live per-share price (best tradable issuer on BSC mainnet) into the pool. */
export async function pushPoolPrices(): Promise<void> {
  const entries = Object.entries(MARKETS);
  const priced = await Promise.allSettled(entries.map(async ([ticker, vToken]) => ({ vToken, price: (await assess(ticker)).view.offers[0].onchain })));
  const ok = priced.flatMap((p) => (p.status === "fulfilled" && p.value.price > 0 ? [p.value] : []));
  if (ok.length === 0) return;
  const hash = await sendTx(VENUS.comptroller, encodeFunctionData({ abi: poolAbi, functionName: "setPrices", args: [ok.map((o) => o.vToken), ok.map((o) => BigInt(Math.round(o.price * 1e6)) * 10n ** 12n)] }));
  log(`prices for ${ok.length}/${entries.length} stock markets [${hash}]`);
}

export async function guardScan(): Promise<void> {
  // Prices first: borrowing needs them fresh, and the guard must judge today's price, not yesterday's.
  await pushPoolPrices().catch((e) => log(`price feed failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`));
  const me = ((await import("@bnbagent/studio-runtime/wallet")).getWallet().address as Address).toLowerCase();
  const borrowers = await read<readonly Address[]>("borrowers");
  const now = Math.floor(Date.now() / 1000);
  let atRisk = 0;
  for (const b of borrowers) {
    try {
      const g = await read<Guard>("guardOf", [b]);
      if (!g.active || g.executor.toLowerCase() !== me) continue;
      const used = await read<bigint>("usedBps", [b]);
      if (used < BigInt(g.triggerBps)) continue;
      atRisk++;
      if (g.lastRescueAt && now < g.lastRescueAt + g.cooldown) {
        log(`${b}: ${pct(used)} of the liquidation limit, past ${pct(g.triggerBps)}; cooling down until ${new Date((g.lastRescueAt + g.cooldown) * 1000).toISOString()}`);
        continue;
      }
      const token = await client().readContract({ address: g.vToken, abi: vTokenAbi, functionName: "underlying" });
      const [balance, allowance] = await Promise.all([
        client().readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [b] }),
        client().readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [b, VENUS.loanGuard] }),
      ]);
      const want = await repayToTarget(b, g);
      const amount = [want, g.maxPerRescue, balance, allowance].reduce((m, v) => (v < m ? v : m));
      if (amount === 0n) {
        log(`${b}: ${pct(used)} past ${pct(g.triggerBps)} but the safety buffer is empty or not approved (balance ${balance}, allowance ${allowance})`);
        continue;
      }
      const hash = await sendTx(VENUS.loanGuard, encodeFunctionData({ abi: loanGuardAbi, functionName: "rescue", args: [b, amount] }));
      const after = await read<bigint>("usedBps", [b]);
      log(`${b}: rescued ${amount} (${amount < want ? "capped" : "to target"}), ${pct(used)} → ${pct(after)} [${hash}]`);
    } catch (e) {
      log(`${b}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }
  log(`scan: ${borrowers.length} borrowers, ${atRisk} past trigger`);
}

/** Start the guard loop (separate cadence from plans: liquidation risk moves faster than a weekly DCA). */
export function startGuardLoop(): () => void {
  if (process.env.PORTIR_LOANGUARD === "off" || process.env.PORTIR_REGISTRY_CHAIN === "mainnet") return () => {};
  const every = Number(process.env.PORTIR_GUARD_SECONDS ?? 300) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await guardScan();
    } catch (e) {
      log(`scan failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  log(`watching LoanGuard ${VENUS.loanGuard} every ${every / 1000}s`);
  void tick();
  const timer = setInterval(tick, every);
  return () => clearInterval(timer);
}
