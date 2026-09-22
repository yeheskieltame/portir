import "server-only";
import { type Candle, type KlineInterval, type StockMeta, klines, listStocks, meta, quoteStock } from "@portir/core/binance";
import { SAMPLE_STOCKS, STOCK_NAMES, type Stock } from "./catalog";

export interface Catalog {
  stocks: Stock[];
  /** Set when live data could not be loaded and `stocks` is sample data. */
  error?: string;
}

async function loadOne(ticker: string, tokens: Awaited<ReturnType<typeof listStocks>>): Promise<Stock> {
  const view = await quoteStock(tokens.filter((t) => t.ticker === ticker));
  const [best] = view.offers;
  const icon = await meta({ chainId: "56", contractAddress: best.contractAddress }).then((m) => m.icon, () => null);
  return {
    ticker: view.ticker,
    name: STOCK_NAMES[view.ticker],
    // No issuer reported a session: assume closed, the cautious reading for the Guard's wording.
    session: view.session ?? "closed",
    halted: best.halted,
    onchain: best.onchain,
    reference: view.reference,
    change24hPct: view.change24hPct,
    icon,
    holders: view.holders,
    stats: view.stats,
    offers: view.offers,
  };
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const tokens = await listStocks();
    const tickers = Object.keys(STOCK_NAMES).filter((ticker) => tokens.some((t) => t.ticker === ticker));
    if (tickers.length === 0) throw new Error("none of the curated tickers are listed on BSC");

    const results = await Promise.allSettled(tickers.map((ticker) => loadOne(ticker, tokens)));
    const stocks = results.flatMap((r, i) => {
      if (r.status === "fulfilled") return [r.value];
      console.error(`quote ${tickers[i]}:`, r.reason);
      return [];
    });
    if (stocks.length === 0) throw new Error("every price request failed");
    return { stocks };
  } catch (e) {
    console.error("live catalog unavailable:", e);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return { stocks: SAMPLE_STOCKS, error: `${e instanceof Error ? e.message : e}${cause}` };
  }
}

export type Range = "1D" | "1W" | "1M" | "1Y";
export const RANGES: Record<Range, { interval: KlineInterval; limit: number }> = {
  "1D": { interval: "15m", limit: 96 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "4h", limit: 180 },
  "1Y": { interval: "1d", limit: 300 },
};

export interface StockDetail {
  stock: Stock;
  meta: StockMeta | null;
  /** Per-share closes for the chosen range; empty when unavailable. */
  candles: Candle[];
  sample: boolean;
}

export async function loadStock(ticker: string, range: Range): Promise<StockDetail | null> {
  if (!(ticker in STOCK_NAMES)) return null;
  try {
    const tokens = await listStocks();
    const stock = await loadOne(ticker, tokens);
    const best = stock.offers![0];
    const token = { chainId: "56", contractAddress: best.contractAddress };
    const [m, c] = await Promise.allSettled([meta(token), klines(token, RANGES[range].interval, RANGES[range].limit)]);
    const candles = c.status === "fulfilled" ? c.value.map((k) => ({ ...k, o: k.o / best.multiplier, h: k.h / best.multiplier, l: k.l / best.multiplier, c: k.c / best.multiplier })) : [];
    return { stock, meta: m.status === "fulfilled" ? m.value : null, candles, sample: false };
  } catch (e) {
    console.error(`live ${ticker} unavailable:`, e);
    const stock = SAMPLE_STOCKS.find((s) => s.ticker === ticker);
    return stock ? { stock, meta: null, candles: sampleCandles(stock.onchain, RANGES[range].limit), sample: true } : null;
  }
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
