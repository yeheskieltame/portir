/**
 * The Guard on live Binance data — the same @portir/core the app uses.
 * Read-only: nothing here signs or spends.
 */
import { type Decision, THRESHOLDS, guard, isSuspectDiscount, spreadBps } from "@portir/core";
import { type StockToken, type StockView, klines, listStocks, meta, quoteStock } from "@portir/core/binance";
import { type BuyQuote, createTrader, usdt } from "@portir/core/trading";

let cached: { at: number; tokens: Promise<StockToken[]> } | undefined;
export function tokenList(): Promise<StockToken[]> {
  if (!cached || Date.now() - cached.at > 60_000) {
    const tokens = listStocks();
    cached = { at: Date.now(), tokens };
    tokens.catch(() => (cached = undefined));
  }
  return cached.tokens;
}

export async function searchStock(query: string) {
  const q = query.trim().toUpperCase();
  const tokens = await tokenList();
  const tickers = [...new Set(tokens.map((t) => t.ticker))].filter((t) => t.includes(q)).slice(0, 10);
  return Promise.all(
    tickers.map(async (ticker) => {
      const own = tokens.filter((t) => t.ticker === ticker);
      const m = await meta({ chainId: "56", contractAddress: own[0].contractAddress }).catch(() => null);
      return { ticker, name: m?.name?.replace(/\s*\([^)]*\)\s*$/, "") ?? ticker, kind: own.find((t) => t.kind)?.kind ?? null, issuers: own.map((t) => ({ issuer: t.issuer, contract: t.contractAddress })) };
    }),
  );
}

export interface Assessment {
  ticker: string;
  view: StockView;
  decision: Decision | null;
  /** One sentence for humans and for `recordRun`. */
  reason: string;
}

/** Guard verdict for a stock using the oracle (on-chain) price of the best issuer. */
export async function assess(ticker: string): Promise<Assessment> {
  const tokens = (await tokenList()).filter((t) => t.ticker === ticker.toUpperCase());
  if (tokens.length === 0) throw new Error(`${ticker} is not listed on BSC`);
  const view = await quoteStock(tokens);
  const best = view.offers[0];
  if (view.reference === null) {
    return { ticker: view.ticker, view, decision: null, reason: "The exchange price is not available right now, so the price cannot be checked." };
  }
  const decision = guard({ session: view.session ?? "closed", halted: best.halted, onchain: best.onchain, reference: view.reference });
  return { ticker: view.ticker, view, decision, reason: decision.reason };
}

export function marketWindow(view: StockView) {
  return { session: view.session ?? "unknown", reference: view.reference, offers: view.offers.map((o) => ({ issuer: o.issuer, onchain: o.onchain, spreadBps: o.spreadBps, halted: o.halted ?? null })), thresholds: THRESHOLDS };
}

export async function history(ticker: string, interval: "15m" | "1h" | "4h" | "1d" = "1h", limit = 168) {
  const tokens = (await tokenList()).filter((t) => t.ticker === ticker.toUpperCase());
  if (tokens.length === 0) throw new Error(`${ticker} is not listed on BSC`);
  const view = await quoteStock(tokens);
  const best = view.offers[0];
  const c = await klines({ chainId: "56", contractAddress: best.contractAddress }, interval, limit);
  return c.map((k) => ({ t: k.t, close: k.c / best.multiplier }));
}

const credentials = () => {
  const { BINANCE_W3_API_KEY: apiKey = "", BINANCE_W3_API_SECRET: apiSecret = "" } = process.env;
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
};

export interface BestRoute {
  issuer: string;
  vendor: string;
  pricePerShare: number;
  shares: number;
  impactBps: number | null;
  spreadBps: number | null;
  decision: Decision | null;
  quote: BuyQuote;
  token: string;
  multiplier: number;
}

/** Executable quotes from the Trading API for the tradable issuers; cheapest per share wins. Needs the API key. */
export async function bestRoute(ticker: string, amountUsdt: number, wallet: string): Promise<BestRoute | { error: string }> {
  const creds = credentials();
  if (!creds) return { error: "Trading API is not configured on this agent (BINANCE_W3_API_KEY/SECRET)" };
  const { view } = await assess(ticker);
  const trader = createTrader(creds);
  const candidates = view.offers.filter((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps))).slice(0, 2);
  const quotes = await Promise.allSettled(candidates.map((o) => trader.quoteBuy({ token: o.contractAddress, multiplier: o.multiplier, usdt: usdt(amountUsdt), wallet })));
  const routed = quotes.flatMap((q, i) => (q.status === "fulfilled" ? [{ offer: candidates[i], quote: q.value }] : []));
  if (routed.length === 0) return { error: quotes.map((q) => (q.status === "rejected" ? String(q.reason?.message ?? q.reason) : "")).join("; ") || "no route" };
  routed.sort((a, b) => a.quote.pricePerShare - b.quote.pricePerShare);
  const { offer, quote } = routed[0];
  const decision = view.reference === null ? null : guard({ session: view.session ?? "closed", onchain: quote.pricePerShare, reference: view.reference });
  return {
    issuer: offer.issuer,
    vendor: quote.vendor,
    pricePerShare: quote.pricePerShare,
    shares: (Number(quote.tokensOut) / 1e18) * offer.multiplier,
    impactBps: quote.impactBps,
    spreadBps: view.reference === null ? null : spreadBps(quote.pricePerShare, view.reference),
    decision,
    quote,
    token: offer.contractAddress,
    multiplier: offer.multiplier,
  };
}
