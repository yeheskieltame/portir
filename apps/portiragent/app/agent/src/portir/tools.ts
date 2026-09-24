/**
 * Portir tools, in two shapes from one definition list:
 *   - MCP tools (Claude Desktop / Claude Code / any MCP client)
 *   - AI SDK tools for the agent's own LLM (A2A / x402 work)
 * All read-only. The two "prepare_*" tools return calldata for the USER's
 * wallet to sign; this agent never signs on a user's behalf.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tool, type ToolSet } from "ai";
import { type Address, createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { bsc } from "viem/chains";
import { z } from "zod";
import { USDT, createTrader, usdt } from "@portir/core/trading";
import { assess, bestRoute, history, marketWindow, searchStock, tokenList } from "./market.js";
import { news } from "./news.js";
import { decodeTarget, getPlan, planIdsOf, prepareCreatePlan, runsOf } from "./registry.js";

type Def<S extends z.ZodRawShape> = { name: string; description: string; input: S; run: (a: z.infer<z.ZodObject<S>>) => Promise<unknown> };
const def = <S extends z.ZodRawShape>(d: Def<S>) => d as Def<z.ZodRawShape>;

const mainnet = () => createPublicClient({ chain: bsc, transport: http(process.env.PORTIR_MAINNET_RPC) });

export const PORTIR_TOOLS = [
  def({
    name: "search_stock",
    description: "Find US stocks/ETFs tradable on BNB Chain by ticker fragment. Returns ticker, name, kind and the issuers (ondo, bstocks, xstocks) with contracts.",
    input: { query: z.string().min(1) },
    run: ({ query }) => searchStock(query),
  }),
  def({
    name: "get_fair_price",
    description: "The Guard's verdict for a stock: on-chain price vs exchange price, spread in bps, session, and GO/WARN/BLOCK with a one-sentence reason. Thresholds: ≤0.5% GO, ≤1% WARN, else BLOCK.",
    input: { ticker: z.string().min(1) },
    run: async ({ ticker }) => {
      const a = await assess(ticker);
      return { ticker: a.ticker, verdict: a.decision?.verdict ?? "UNKNOWN", spreadBps: a.decision?.spreadBps ?? null, reason: a.reason, onchain: a.view.offers[0].onchain, reference: a.view.reference, issuer: a.view.offers[0].issuer, session: a.view.session };
    },
  }),
  def({
    name: "market_window",
    description: "US market session (open/pre/after/closed), halts, and every issuer's on-chain price for a stock. Use before deciding when to buy.",
    input: { ticker: z.string().min(1) },
    run: async ({ ticker }) => marketWindow((await assess(ticker)).view),
  }),
  def({
    name: "price_history",
    description: "Per-share on-chain price history for a stock. interval 15m|1h|4h|1d, up to 300 points.",
    input: { ticker: z.string().min(1), interval: z.enum(["15m", "1h", "4h", "1d"]).optional(), limit: z.number().int().min(2).max(300).optional() },
    run: ({ ticker, interval, limit }) => history(ticker, interval ?? "1h", limit ?? 168),
  }),
  def({
    name: "get_news",
    description: "Latest headlines for a stock (Yahoo Finance) plus crypto/RWA context (CoinDesk, when configured).",
    input: { ticker: z.string().min(1), limit: z.number().int().min(1).max(12).optional() },
    run: ({ ticker, limit }) => news(ticker, limit ?? 6),
  }),
  def({
    name: "quote_best_issuer",
    description: "Executable quote from the Binance Trading API for buying a stock with USDT on BNB Chain: cheapest issuer, price per share, expected shares, impact, and the Guard verdict on the executable price. Read-only.",
    input: { ticker: z.string().min(1), usdt: z.number().min(1).max(10_000), wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    run: async ({ ticker, usdt: amount, wallet }) => {
      const r = await bestRoute(ticker, amount, wallet);
      if ("error" in r) return r;
      const { quote: _q, ...rest } = r;
      return rest;
    },
  }),
  def({
    name: "prepare_buy",
    description: "Guarded buy, unsigned: returns the Guard verdict and, unless BLOCK, the USDT approval and swap calldata for the user's wallet to sign on BNB Chain (chainId 56). Nothing is sent by this tool.",
    input: { ticker: z.string().min(1), usdt: z.number().min(1).max(10_000), wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    run: async ({ ticker, usdt: amount, wallet }) => {
      const r = await bestRoute(ticker, amount, wallet);
      if ("error" in r) return r;
      const { quote, decision, ...rest } = r;
      if (!decision || decision.verdict === "BLOCK") return { ...rest, verdict: decision?.verdict ?? "UNKNOWN", reason: decision?.reason ?? "no exchange price" };
      const { BINANCE_W3_API_KEY: apiKey = "", BINANCE_W3_API_SECRET: apiSecret = "" } = process.env;
      const built = await createTrader({ apiKey, apiSecret }).buildBuy({ token: r.token, multiplier: r.multiplier, usdt: usdt(amount), wallet }, quote);
      if (!built.tx) return { ...rest, verdict: decision.verdict, reason: decision.reason, error: "RFQ route not supported" };
      return {
        ...rest,
        verdict: decision.verdict,
        reason: decision.reason,
        minShares: built.minTokensOut ? (Number(built.minTokensOut) / 1e18) * r.multiplier : null,
        chainId: 56,
        approvals: built.approvals.map((a) => JSON.parse(a) as { approveContract: string; approveTxCalldata: string }).map((a) => ({ to: USDT, data: a.approveTxCalldata, spender: a.approveContract })),
        tx: { to: built.tx.to, data: built.tx.data, value: built.tx.value },
      };
    },
  }),
  def({
    name: "get_portfolio",
    description: "Stock-token holdings of a BNB Chain address as shares (raw balance × issuer multiplier) with today's on-chain price.",
    input: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    run: async ({ address }) => {
      const tokens = await tokenList();
      const pc = mainnet();
      const balances = await pc.multicall({ contracts: tokens.map((t) => ({ address: t.contractAddress as Address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address as Address] })), allowFailure: true });
      const held = tokens.filter((_, i) => balances[i].status === "success" && (balances[i].result as bigint) > 0n);
      const tickers = [...new Set(held.map((t) => t.ticker))];
      const out = await Promise.all(
        tickers.map(async (ticker) => {
          const a = await assess(ticker);
          const shares = held.filter((t) => t.ticker === ticker).reduce((n, t, _, __) => {
            const i = tokens.indexOf(t);
            const offer = a.view.offers.find((o) => o.contractAddress.toLowerCase() === t.contractAddress.toLowerCase());
            return n + Number(formatUnits(balances[i].result as bigint, 18)) * (offer?.multiplier ?? 1);
          }, 0);
          return { ticker, shares, price: a.view.offers[0].onchain, value: shares * a.view.offers[0].onchain };
        }),
      );
      return { address, holdings: out, total: out.reduce((n, h) => n + h.value, 0) };
    },
  }),
  def({
    name: "list_plans",
    description: "DCA plans of an address in PlanRegistry with status and run history (the executor's reasons).",
    input: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
    run: async ({ address }) => {
      const ids = await planIdsOf(address as Address);
      return Promise.all(
        ids.map(async (id) => {
          const [p, runs] = await Promise.all([getPlan(id), runsOf(id)]);
          return { planId: Number(id), target: decodeTarget(p.target), usdt: Number(formatUnits(p.amount, 18)), intervalDays: p.interval / 86_400, nextRunAt: p.nextRunAt, smartTiming: p.smartTiming, active: p.active, runs: runs.map((r) => ({ at: r.at, outcome: ["Executed", "Waited", "Skipped"][r.outcome], spreadBps: r.spreadBps, reason: r.reason, txHash: r.txHash })) };
        }),
      );
    },
  }),
  def({
    name: "prepare_dca_plan",
    description: "Unsigned createPlan calldata for PlanRegistry, with this agent as executor. The user's wallet signs it. target = ticker or 'BASKET:<name>'.",
    input: { target: z.string().min(1), usdt: z.number().min(1), intervalDays: z.union([z.literal(7), z.literal(14), z.literal(30)]), smartTiming: z.boolean().optional(), once: z.boolean().optional().describe("true = buy one time when the Guard says GO, then stop (no repeat)") },
    run: async ({ target, usdt: amount, intervalDays, smartTiming, once }) => prepareCreatePlan({ target, usdt: amount, intervalDays, smartTiming: smartTiming ?? true, once: once ?? false }),
  }),
];

PORTIR_TOOLS.push(
  def({
    name: "executor_status",
    description: "How this agent executes plans: execution backend, Agentic Wallet session state and limits, scan interval.",
    input: {},
    run: async () => {
      const mode = process.env.PORTIR_EXECUTION ?? "off";
      let wallet: unknown = null;
      if (mode === "agentic-wallet") {
        const { status, settings, bscAddress } = await import("./agenticWallet.js");
        wallet = await Promise.all([status(), settings(), bscAddress()]).then(([s, cfg, address]) => ({ status: s.status, address, sessionExpireTime: cfg.sessionExpireTime, dailyLimit: cfg.dailyLimit, quotaLeft: cfg.quotaLeft })).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      }
      return { execution: mode, registry: process.env.PORTIR_REGISTRY ?? null, scanSeconds: Number(process.env.PORTIR_SCAN_SECONDS ?? 900), agenticWallet: wallet };
    },
  }),
);

const text = (payload: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(payload) }] });

export function registerPortirMcpTools(server: McpServer): void {
  for (const t of PORTIR_TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true, openWorldHint: true } }, async (args) => {
      try {
        return text(await t.run(args as never));
      } catch (e) {
        return { ...text({ error: e instanceof Error ? e.message : String(e) }), isError: true };
      }
    });
  }
}

export const PORTIR_LLM_TOOLS: ToolSet = Object.fromEntries(
  PORTIR_TOOLS.map((t) => [t.name, tool({ description: t.description, inputSchema: z.object(t.input), execute: async (args) => t.run(args as never) })]),
);
