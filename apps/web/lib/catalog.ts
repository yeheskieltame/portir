import type { Session } from "@portir/core";
import type { AssetKind, StockStats } from "@portir/core/binance";

export interface Offer {
  issuer: string;
  contractAddress: string;
  multiplier: number;
  onchain: number;
  spreadBps: number | null;
  halted?: string;
}

export interface Stock {
  ticker: string;
  name: string;
  kind: AssetKind | null;
  session: Session;
  halted?: string;
  onchain: number;
  /** null when the exchange price is unavailable (the API returns none outside trading hours). */
  reference: number | null;
  change24hPct: number | null;
  icon: string | null;
  holders?: number | null;
  stats?: StockStats;
  /** Every issuer's price for this stock, best first. `onchain` above is the first one. */
  offers?: Offer[];
}

// Featured tickers, listed first. Names are ours: principle 1, "stocks, not tokens". Everything else is named from the issuer's token name.
export const STOCK_NAMES: Record<string, string> = {
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  AAPL: "Apple",
  MSFT: "Microsoft",
  GOOGL: "Alphabet (Google)",
  AMZN: "Amazon",
  QQQ: "Nasdaq 100 ETF",
  SPY: "S&P 500 ETF",
};

export { BASKETS, targetLegs, type Basket } from "@portir/core/catalog";

const NO_STATS: StockStats = { high52w: null, low52w: null, pe: null, dividendYield: null, marketCap: null };
const sample = (s: Omit<Stock, "icon" | "change24hPct" | "kind"> & { change24hPct?: number; kind?: AssetKind }): Stock => ({ icon: null, change24hPct: null, kind: "stock", stats: NO_STATS, ...s });

// Made-up prices that exercise every Guard verdict. Shown only when live data is unreachable, and labelled.
export const SAMPLE_STOCKS: Stock[] = [
  sample({ ticker: "NVDA", name: "NVIDIA", session: "closed", onchain: 191.2, reference: 191.05, change24hPct: 1.31 }),
  sample({ ticker: "TSLA", name: "Tesla", session: "closed", onchain: 352.1, reference: 348.9, change24hPct: -0.44 }),
  sample({ ticker: "AAPL", name: "Apple", session: "closed", onchain: 243.6, reference: 240.3, change24hPct: 0.12 }),
  sample({ ticker: "MSFT", name: "Microsoft", session: "closed", onchain: 512.0, reference: null, change24hPct: 0.8 }),
  sample({ ticker: "QQQ", name: "Nasdaq 100 ETF", kind: "etf", session: "closed", onchain: 601.3, reference: 600.2, change24hPct: 0.3 }),
  sample({ ticker: "SPY", name: "S&P 500 ETF", kind: "etf", session: "closed", halted: "cash_dividend", onchain: 668.1, reference: 668.0, change24hPct: 0.05 }),
];
