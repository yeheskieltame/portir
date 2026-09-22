// Binance Web3 RWA Data API (public, no key). Spec: binance/binance-skills-hub,
// skills/binance-web3/binance-tokenized-securities-info/SKILL.md v1.1.
// The live API covers more than that spec says; differences are noted inline and in DEVEX_REPORT.md.
// Server-side only: www.binance.com is DNS-blocked by Indonesian ISPs, so a browser in Jogja cannot reach it.
import { type Session, isSuspectDiscount, spreadBps } from "./index.ts";

const BASE = "https://www.binance.com/bapi/defi";
const RWA = "public/wallet-direct/buw/wallet/market/token/rwa";
const DEX = "public/wallet-direct/buw/wallet/dex/market/token";
const STATIC = "https://bin.bnbstatic.com";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

export const BSC = "56";

// `type` in the stock list. The spec documents only 1; 2 and 3 were identified live from token symbols
// (NVDAon / NVDAx / NVDAB). Other types (4, 5, 9, 11) are other products or chains and are ignored.
export type Issuer = "ondo" | "xstocks" | "bstocks";
const ISSUERS: Record<number, Issuer> = { 1: "ondo", 2: "xstocks", 3: "bstocks" };

export type AssetKind = "stock" | "etf";
const KINDS: Record<number, AssetKind> = { 1: "stock", 3: "etf" }; // `assetType`, identified live (QQQ, SPY, IVV... are 3)

export interface StockToken {
  chainId: string;
  contractAddress: string;
  symbol: string;
  ticker: string;
  issuer: Issuer;
  kind: AssetKind | null;
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

/** US stock fundamentals from `dynamic.stockInfo`; every field can be missing. */
export interface StockStats {
  high52w: number | null;
  low52w: number | null;
  pe: number | null;
  /** Percent, e.g. 0.27 means 0.27%. */
  dividendYield: number | null;
  marketCap: number | null;
}

export interface StockQuote extends TradingStatus {
  ticker: string;
  issuer: Issuer;
  contractAddress: string;
  /** On-chain price per share (token price / multiplier), USD. */
  onchain: number;
  /** Exchange price per share, USD. Null outside trading hours, and always null for bStocks. */
  reference: number | null;
  multiplier: number;
  /** On-chain 24h change, percent. */
  change24hPct: number | null;
  holders: number | null;
  stats: StockStats;
}

export class BinanceApiError extends Error {}

async function get(version: "v1" | "v2", path: string, params: Record<string, string | number> = {}, root = RWA) {
  const url = new URL(`${BASE}/${version}/${root}/${path}/ai`);
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
const maybe = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

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
      kind: KINDS[t.assetType] ?? null,
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
  const stock = dynamic.stockInfo ?? {};
  return {
    ...toStatus(dynamic.statusInfo),
    ticker: token.ticker,
    issuer: token.issuer,
    contractAddress: token.contractAddress,
    onchain: num(dynamic.tokenInfo?.price, "tokenInfo.price") / multiplier,
    reference: stock.price == null ? null : num(stock.price, "stockInfo.price"),
    multiplier,
    change24hPct: maybe(dynamic.tokenInfo?.priceChangePct24h),
    holders: maybe(dynamic.tokenInfo?.totalHolders),
    stats: {
      high52w: maybe(stock.priceHigh52w),
      low52w: maybe(stock.priceLow52w),
      pe: maybe(stock.priceToEarnings),
      dividendYield: maybe(stock.dividendYield),
      marketCap: maybe(stock.marketCap),
    },
  };
}

export interface StockMeta {
  name: string;
  icon: string | null;
  company: { name: string | null; industry: string | null; ceo: string | null; description: string | null; homepage: string | null };
}

/** Token logo and company profile (API 2, "RWA Meta"). */
export async function meta(token: Pick<StockToken, "chainId" | "contractAddress">): Promise<StockMeta> {
  const d = (await get("v1", "meta", { chainId: token.chainId, contractAddress: token.contractAddress })) as any;
  const c = d.companyInfo ?? {};
  return {
    name: d.name ?? "",
    icon: d.icon ? `${STATIC}${d.icon}` : null,
    company: {
      name: c.companyName ?? null,
      industry: c.industry ?? null,
      ceo: c.ceo ?? null,
      description: c.description ?? null,
      homepage: c.homepageUrl || null,
    },
  };
}

export type KlineInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "12h" | "1d";
export interface Candle {
  /** Open time, ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export function parseKlines(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new BinanceApiError("klineInfos: not an array");
  return rows.map((r: any[]) => ({ t: num(r[0], "openTime"), o: num(r[1], "open"), h: num(r[2], "high"), l: num(r[3], "low"), c: num(r[4], "close") }));
}

/** On-chain token price candles (API 6). Prices are per token, so divide by the multiplier for per-share. */
export async function klines(token: Pick<StockToken, "chainId" | "contractAddress">, interval: KlineInterval, limit = 300): Promise<Candle[]> {
  const d = (await get("v1", "kline", { chainId: token.chainId, contractAddress: token.contractAddress, interval, limit }, DEX)) as any;
  return parseKlines(d.klineInfos);
}

export interface IssuerOffer {
  issuer: Issuer;
  contractAddress: string;
  multiplier: number;
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
  /** From the best offer's token. */
  change24hPct: number | null;
  holders: number | null;
  stats: StockStats;
}

/** One stock across all its issuers: the exchange price and session are per stock, so they are shared. */
export async function quoteStock(tokens: StockToken[]): Promise<StockView> {
  const settled = await Promise.allSettled(tokens.map(quote));
  const quotes = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (quotes.length === 0) throw (settled[0] as PromiseRejectedResult).reason;

  const reference = quotes.find((q) => q.reference !== null)?.reference ?? null;
  const offers = quotes.map((q) => ({
    issuer: q.issuer,
    contractAddress: q.contractAddress,
    multiplier: q.multiplier,
    onchain: q.onchain,
    halted: q.halted,
    spreadBps: reference === null ? null : spreadBps(q.onchain, reference),
  }));
  // ponytail: the reference is shared, so cheapest on-chain price = lowest spread. Price impact and volume
  // (core's pickIssuer) join once the Trading API quote is wired in. Halted and stale-looking offers go last.
  const penalty = (o: IssuerOffer) => (o.halted ? 2 : o.spreadBps !== null && isSuspectDiscount(o.spreadBps) ? 1 : 0);
  offers.sort((a, b) => penalty(a) - penalty(b) || a.onchain - b.onchain);

  const best = quotes.find((q) => q.contractAddress === offers[0].contractAddress)!;
  // Fundamentals are per stock, so take them from whichever issuer reports them.
  const stats = quotes.map((q) => q.stats).find((s) => s.high52w !== null) ?? best.stats;
  return {
    ticker: quotes[0].ticker,
    session: quotes.find((q) => q.session !== null)?.session ?? null,
    reference,
    offers,
    change24hPct: best.change24hPct,
    holders: quotes.some((q) => q.holders !== null) ? quotes.reduce((n, q) => n + (q.holders ?? 0), 0) : null,
    stats,
  };
}
