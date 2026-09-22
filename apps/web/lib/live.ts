import "server-only";
import { type AssetKind, type Candle, type KlineInterval, type StockMeta, type StockToken, klines, listStocks, meta, quoteStock } from "@portir/core/binance";
import { SAMPLE_STOCKS, STOCK_NAMES, type Stock } from "./catalog";

export const PER_PAGE = 10;

/** "C3.ai (Ondo Tokenized)" → "C3.ai". Issuer token names carry the issuer in a trailing bracket. */
const cleanName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();

async function loadOne(ticker: string, tokens: StockToken[]): Promise<Stock> {
  const own = tokens.filter((t) => t.ticker === ticker);
  const view = await quoteStock(own);
  const [best] = view.offers;
  const m = await meta({ chainId: "56", contractAddress: best.contractAddress }).catch(() => null);
  return {
    ticker: view.ticker,
    name: STOCK_NAMES[ticker] ?? (m?.name ? cleanName(m.name) : ticker),
    kind: own.find((t) => t.kind)?.kind ?? null,
    // No issuer reported a session: assume closed, the cautious reading for the Guard's wording.
    session: view.session ?? "closed",
    halted: best.halted,
    onchain: best.onchain,
    reference: view.reference,
    change24hPct: view.change24hPct,
    icon: m?.icon ?? null,
    holders: view.holders,
    stats: view.stats,
    offers: view.offers,
  };
}

async function loadMany(tickers: string[], tokens: StockToken[]): Promise<Stock[]> {
  const results = await Promise.allSettled(tickers.map((t) => loadOne(t, tokens)));
  return results.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    console.error(`quote ${tickers[i]}:`, r.reason);
    return [];
  });
}

/** Live quotes for a fixed set of tickers (basket pages). Missing tickers are dropped. */
export async function loadStocks(tickers: string[]): Promise<{ stocks: Stock[]; error?: string }> {
  try {
    const tokens = await listStocks();
    const stocks = await loadMany(tickers.filter((t) => tokens.some((k) => k.ticker === t)), tokens);
    if (stocks.length === 0) throw new Error("every price request failed");
    return { stocks };
  } catch (e) {
    console.error("live quotes unavailable:", e);
    return { stocks: SAMPLE_STOCKS.filter((s) => tickers.includes(s.ticker)), error: e instanceof Error ? e.message : String(e) };
  }
}

export interface MarketQuery {
  q?: string;
  kind?: AssetKind;
  page?: number;
}
export interface Market {
  stocks: Stock[];
  total: number;
  page: number;
  pages: number;
  /** Set when live data could not be loaded and `stocks` is sample data. */
  error?: string;
}

const featured = Object.keys(STOCK_NAMES);
const rank = (t: string) => (featured.includes(t) ? featured.indexOf(t) : featured.length);

/** One page of the market: every US stock/ETF on BSC, featured first, priced only for the page shown. */
export async function loadMarket({ q = "", kind, page = 1 }: MarketQuery): Promise<Market> {
  try {
    const tokens = await listStocks();
    const needle = q.trim().toUpperCase();
    const tickers = [...new Set(tokens.map((t) => t.ticker))]
      .filter((t) => !kind || tokens.some((k) => k.ticker === t && k.kind === kind))
      .filter((t) => !needle || t.includes(needle) || STOCK_NAMES[t]?.toUpperCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const pages = Math.max(1, Math.ceil(tickers.length / PER_PAGE));
    const current = Math.min(Math.max(1, page), pages);
    const stocks = await loadMany(tickers.slice((current - 1) * PER_PAGE, current * PER_PAGE), tokens);
    if (stocks.length === 0 && tickers.length > 0) throw new Error("every price request failed");
    return { stocks, total: tickers.length, page: current, pages };
  } catch (e) {
    console.error("live market unavailable:", e);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return { stocks: SAMPLE_STOCKS, total: SAMPLE_STOCKS.length, page: 1, pages: 1, error: `${e instanceof Error ? e.message : e}${cause}` };
  }
}

export type Range = "1D" | "1W" | "1M" | "1Y";
export const RANGES: Record<Range, { interval: KlineInterval; limit: number }> = {
  "1D": { interval: "15m", limit: 96 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "4h", limit: 180 },
  "1Y": { interval: "1d", limit: 300 },
};

const perShare = (c: Candle, m: number): Candle => ({ ...c, o: c.o / m, h: c.h / m, l: c.l / m, c: c.c / m });

export interface StockDetail {
  stock: Stock;
  meta: StockMeta | null;
  /** Per-share candles for the chosen range; empty when unavailable. */
  candles: Candle[];
  sample: boolean;
}

export async function loadStock(ticker: string, range: Range): Promise<StockDetail | null> {
  try {
    const tokens = await listStocks();
    if (!tokens.some((t) => t.ticker === ticker)) return null;
    const stock = await loadOne(ticker, tokens);
    const best = stock.offers![0];
    const token = { chainId: "56", contractAddress: best.contractAddress };
    const [m, c] = await Promise.allSettled([meta(token), klines(token, RANGES[range].interval, RANGES[range].limit)]);
    return { stock, meta: m.status === "fulfilled" ? m.value : null, candles: c.status === "fulfilled" ? c.value.map((k) => perShare(k, best.multiplier)) : [], sample: false };
  } catch (e) {
    console.error(`live ${ticker} unavailable:`, e);
    const stock = SAMPLE_STOCKS.find((s) => s.ticker === ticker);
    return stock ? { stock, meta: null, candles: sampleCandles(stock.onchain, RANGES[range].limit), sample: true } : null;
  }
}

/** Every stock token on BSC, for balance reads. */
export async function loadTokens(): Promise<{ ticker: string; address: `0x${string}`; multiplier: number }[]> {
  try {
    const tokens = await listStocks();
    // `multiplier` from the list is unreliable for xStocks (see core); balances are re-priced through /api/quote anyway.
    return tokens.map((t) => ({ ticker: t.ticker, address: t.contractAddress as `0x${string}`, multiplier: 1 }));
  } catch (e) {
    console.error("token list unavailable:", e);
    return [];
  }
}

export interface Quoted {
  name: string;
  icon: string | null;
  onchain: number;
  change24hPct: number | null;
  /** Per-share closes, oldest first: [openTime, close]. */
  series: [number, number][];
  /** Per contract address, so a balance can be turned into shares. */
  multipliers: Record<string, number>;
  /** Best provider's share multiplier: 1.0017 means 0.17% of every holding's shares came from reinvested dividends. */
  multiplier: number;
  /** Percent per year, from the exchange. */
  dividendYield: number | null;
}

/** Prices and history for held tickers; the portfolio polls this. */
export async function quoteMany(tickers: string[], range: Range): Promise<Record<string, Quoted>> {
  const tokens = await listStocks();
  const stocks = await loadMany(tickers.filter((t) => tokens.some((k) => k.ticker === t)), tokens);
  const out: Record<string, Quoted> = {};
  await Promise.all(
    stocks.map(async (s) => {
      const best = s.offers![0];
      const c = await klines({ chainId: "56", contractAddress: best.contractAddress }, RANGES[range].interval, RANGES[range].limit).catch(() => []);
      out[s.ticker] = {
        name: s.name,
        icon: s.icon,
        onchain: s.onchain,
        change24hPct: s.change24hPct,
        series: c.map((k) => [k.t, k.c / best.multiplier]),
        multipliers: Object.fromEntries(s.offers!.map((o) => [o.contractAddress.toLowerCase(), o.multiplier])),
        multiplier: best.multiplier,
        dividendYield: s.stats?.dividendYield ?? null,
      };
    }),
  );
  return out;
}

function sampleCandles(last: number, n: number): Candle[] {
  let s = 7, p = last * 0.94;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296 - 0.5);
  const step = 3600_000;
  return Array.from({ length: n }, (_, i) => {
    const o = p; p = i === n - 1 ? last : p * (1 + rnd() * 0.02 + 0.0005);
    return { t: Date.now() - (n - i) * step, o, c: p, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997 };
  });
}
