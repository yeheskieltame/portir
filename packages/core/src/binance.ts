// Binance Web3 RWA Data API (public, no key). Spec: binance/binance-skills-hub,
// skills/binance-web3/binance-tokenized-securities-info/SKILL.md v1.1.
// The live API covers more than that spec says; differences are noted inline and in DEVEX_REPORT.md.
// Server-side only: www.binance.com is DNS-blocked by Indonesian ISPs, so a browser in Jogja cannot reach it.
import { type Session, isSuspectDiscount, spreadBps } from "./index.ts";

const BASE = "https://www.binance.com/bapi/defi";
const RWA = "public/wallet-direct/buw/wallet/market/token/rwa";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

export const BSC = "56";

// `type` in the stock list. The spec documents only 1; 2 and 3 were identified live from token symbols
// (NVDAon / NVDAx / NVDAB). Other types (4, 5, 9, 11) are other products or chains and are ignored.
export type Issuer = "ondo" | "xstocks" | "bstocks";
const ISSUERS: Record<number, Issuer> = { 1: "ondo", 2: "xstocks", 3: "bstocks" };

export interface StockToken {
  chainId: string;
  contractAddress: string;
  symbol: string;
  ticker: string;
  issuer: Issuer;
}

export interface TradingStatus {
  open: boolean;
  /** US exchange session. Only Ondo reports it; null for xStocks and bStocks. */
  session: Session | null;
  /** Corporate action or outage keeping the asset from trading normally; undefined when it is just after hours. */
  halted?: string;
  nextOpenAt?: Date;
  nextCloseAt?: Date;
}

export interface StockQuote extends TradingStatus {
  ticker: string;
  issuer: Issuer;
  /** On-chain price per share (token price / multiplier), USD. */
  onchain: number;
  /** Exchange price per share, USD. Null outside trading hours, and always null for bStocks. */
  reference: number | null;
  multiplier: number;
}

export class BinanceApiError extends Error {}

async function get(version: "v1" | "v2", path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${BASE}/${version}/${RWA}/${path}/ai`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new BinanceApiError(`${path}: HTTP ${res.status}`);
  const body = (await res.json()) as { code?: string; success?: boolean; message?: string; data?: unknown };
  if (!body.success || body.data == null) {
    throw new BinanceApiError(`${path}: ${body.code ?? "no code"} ${body.message ?? ""}`.trim());
  }
  return body.data;
}

function num(value: unknown, field: string): number {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) throw new BinanceApiError(`${field}: not a number`);
  return n;
}

const SESSIONS: Record<string, Session> = {
  regular: "open",
  premarket: "pre",
  postmarket: "after",
  overnight: "closed",
  closed: "closed",
  pause: "closed",
};
const NOT_A_HALT = new Set(["TRADING", "MARKET_CLOSED"]);

function toStatus(raw: any): TradingStatus {
  const code: string | null = raw?.reasonCode ?? null;
  return {
    open: raw?.openState === true,
    // `open` is the issuer's own availability (covers overnight), so it says nothing about the session.
    session: raw?.marketStatus == null ? null : (SESSIONS[raw.marketStatus] ?? "closed"),
    halted: code && !NOT_A_HALT.has(code) ? (raw.reasonMsg ?? code) : undefined,
    nextOpenAt: raw?.nextOpenTime ? new Date(raw.nextOpenTime) : undefined,
    nextCloseAt: raw?.nextCloseTime ? new Date(raw.nextCloseTime) : undefined,
  };
}

export async function listStocks(chainId: string = BSC): Promise<StockToken[]> {
  const data = (await get("v1", "stock/detail/list")) as any[];
  if (!Array.isArray(data)) throw new BinanceApiError("stock list: not an array");
  // The list's own `multiplier` is dropped on purpose: for xStocks it says 1 while `dynamic` has the real value.
  return data
    .filter((t) => t.chainId === chainId && t.type in ISSUERS)
    .map((t) => ({
      chainId: t.chainId,
      contractAddress: t.contractAddress,
      symbol: t.symbol,
      ticker: t.ticker,
      issuer: ISSUERS[t.type],
    }));
}

export async function marketStatus(): Promise<TradingStatus> {
  return toStatus(await get("v1", "market/status"));
}

export async function assetStatus(token: Pick<StockToken, "chainId" | "contractAddress">): Promise<TradingStatus> {
  return toStatus(await get("v1", "asset/market/status", { chainId: token.chainId, contractAddress: token.contractAddress }));
}

/** Price and status for one issuer's token, in one request (live `statusInfo` is populated, unlike the spec sample). */
export async function quote(token: StockToken): Promise<StockQuote> {
  const dynamic = (await get("v2", "dynamic", { chainId: token.chainId, contractAddress: token.contractAddress })) as any;

  const multiplier = num(dynamic.tokenInfo?.sharesMultiplier, "sharesMultiplier");
  if (multiplier <= 0) throw new BinanceApiError("sharesMultiplier: must be positive");
  const stockPrice = dynamic.stockInfo?.price;
  return {
    ...toStatus(dynamic.statusInfo),
    ticker: token.ticker,
    issuer: token.issuer,
    onchain: num(dynamic.tokenInfo?.price, "tokenInfo.price") / multiplier,
    reference: stockPrice == null ? null : num(stockPrice, "stockInfo.price"),
    multiplier,
  };
}

export interface IssuerOffer {
  issuer: Issuer;
  onchain: number;
  halted?: string;
  /** Premium over the exchange price; null when no issuer reported one. */
  spreadBps: number | null;
}

export interface StockView {
  ticker: string;
  /** From whichever issuer reports it (Ondo today); null when none does. */
  session: Session | null;
  reference: number | null;
  /** Cheapest tradable issuer first. */
  offers: IssuerOffer[];
}

/** One stock across all its issuers: the exchange price and session are per stock, so they are shared. */
export async function quoteStock(tokens: StockToken[]): Promise<StockView> {
  const settled = await Promise.allSettled(tokens.map(quote));
  const quotes = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (quotes.length === 0) throw (settled[0] as PromiseRejectedResult).reason;

  const reference = quotes.find((q) => q.reference !== null)?.reference ?? null;
  const offers = quotes.map((q) => ({
    issuer: q.issuer,
    onchain: q.onchain,
    halted: q.halted,
    spreadBps: reference === null ? null : spreadBps(q.onchain, reference),
  }));
  // ponytail: the reference is shared, so cheapest on-chain price = lowest spread. Price impact and volume
  // (core's pickIssuer) join once the Trading API quote is wired in. Halted and stale-looking offers go last.
  const penalty = (o: IssuerOffer) => (o.halted ? 2 : o.spreadBps !== null && isSuspectDiscount(o.spreadBps) ? 1 : 0);
  offers.sort((a, b) => penalty(a) - penalty(b) || a.onchain - b.onchain);

  return { ticker: quotes[0].ticker, session: quotes.find((q) => q.session !== null)?.session ?? null, reference, offers };
}
