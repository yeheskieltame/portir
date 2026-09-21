// Binance Web3 RWA Data API (public, no key). Spec: binance/binance-skills-hub,
// skills/binance-web3/binance-tokenized-securities-info/SKILL.md v1.1.
// Server-side only: www.binance.com is DNS-blocked by Indonesian ISPs, so a browser in Jogja cannot reach it.
import type { Session } from "./index.ts";

const BASE = "https://www.binance.com/bapi/defi";
const RWA = "public/wallet-direct/buw/wallet/market/token/rwa";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

export const BSC = "56";
const ONDO = 1; // the only issuer this API covers today

export interface StockToken {
  chainId: string;
  contractAddress: string;
  symbol: string;
  ticker: string;
  /** Shares per token: grows with reinvested dividends, jumps on splits. Never hardcode. */
  multiplier: number;
}

export interface TradingStatus {
  open: boolean;
  session: Session;
  /** Corporate action or outage keeping the asset from trading normally; undefined when it is just after hours. */
  halted?: string;
  nextOpenAt?: Date;
  nextCloseAt?: Date;
}

export interface StockQuote extends TradingStatus {
  ticker: string;
  /** On-chain price per share (token price / multiplier), USD. */
  onchain: number;
  /** Exchange price per share, USD. The API returns null outside trading hours. */
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

const SESSIONS: Record<string, Session> = { regular: "open", premarket: "pre", postmarket: "after" };
const NOT_A_HALT = new Set(["TRADING", "MARKET_CLOSED"]);

function toStatus(raw: any): TradingStatus {
  const code: string | null = raw?.reasonCode ?? null;
  return {
    open: raw?.openState === true,
    // overnight, closed, pause, or absent (market/status has no session field): not a US exchange session.
    // `open` is Ondo's own availability, which also covers overnight, so it says nothing about the session.
    session: SESSIONS[raw?.marketStatus] ?? "closed",
    halted: code && !NOT_A_HALT.has(code) ? (raw.reasonMsg ?? code) : undefined,
    nextOpenAt: raw?.nextOpenTime ? new Date(raw.nextOpenTime) : undefined,
    nextCloseAt: raw?.nextCloseTime ? new Date(raw.nextCloseTime) : undefined,
  };
}

export async function listStocks(chainId: string = BSC): Promise<StockToken[]> {
  const data = (await get("v1", "stock/detail/list", { type: ONDO })) as any[];
  if (!Array.isArray(data)) throw new BinanceApiError("stock list: not an array");
  return data
    .filter((t) => t.chainId === chainId)
    .map((t) => ({
      chainId: t.chainId,
      contractAddress: t.contractAddress,
      symbol: t.symbol,
      ticker: t.ticker,
      multiplier: num(t.multiplier, "multiplier"),
    }));
}

export async function marketStatus(): Promise<TradingStatus> {
  return toStatus(await get("v1", "market/status"));
}

export async function assetStatus(token: Pick<StockToken, "chainId" | "contractAddress">): Promise<TradingStatus> {
  return toStatus(await get("v1", "asset/market/status", { chainId: token.chainId, contractAddress: token.contractAddress }));
}

/** Price and status for one token. `statusInfo` can come back all-null, so the asset status is fetched alongside. */
export async function quote(token: Pick<StockToken, "chainId" | "contractAddress">): Promise<StockQuote> {
  const params = { chainId: token.chainId, contractAddress: token.contractAddress };
  const [dynamic, status] = await Promise.all([get("v2", "dynamic", params) as Promise<any>, assetStatus(token)]);

  const multiplier = num(dynamic.tokenInfo?.sharesMultiplier, "sharesMultiplier");
  if (multiplier <= 0) throw new BinanceApiError("sharesMultiplier: must be positive");
  const stockPrice = dynamic.stockInfo?.price;
  return {
    ...status,
    ticker: dynamic.ticker,
    onchain: num(dynamic.tokenInfo?.price, "tokenInfo.price") / multiplier,
    reference: stockPrice == null ? null : num(stockPrice, "stockInfo.price"),
    multiplier,
  };
}
