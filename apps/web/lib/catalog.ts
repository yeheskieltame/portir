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

export interface Basket {
  slug: string;
  name: string;
  blurb: string;
  /** Weights sum to 100. Buying a basket is one guarded swap per leg. */
  legs: { ticker: string; weight: number }[];
}

// PRD F4: curated, transparent, static. Rebalancing on drift is P1.
export const BASKETS: Basket[] = [
  { slug: "ai-semis", name: "AI & Semis", blurb: "The chips, fabs and clouds behind AI.", legs: [{ ticker: "NVDA", weight: 30 }, { ticker: "AMD", weight: 15 }, { ticker: "AVGO", weight: 15 }, { ticker: "TSM", weight: 15 }, { ticker: "MSFT", weight: 15 }, { ticker: "GOOGL", weight: 10 }] },
  { slug: "big-tech", name: "Big Tech", blurb: "The five platforms most of the internet runs on.", legs: [{ ticker: "AAPL", weight: 20 }, { ticker: "MSFT", weight: 20 }, { ticker: "GOOGL", weight: 20 }, { ticker: "AMZN", weight: 20 }, { ticker: "META", weight: 20 }] },
  { slug: "dividend-blue-chips", name: "Dividend Blue-chips", blurb: "Household names that have paid dividends for decades.", legs: [{ ticker: "JNJ", weight: 20 }, { ticker: "PG", weight: 20 }, { ticker: "KO", weight: 20 }, { ticker: "PEP", weight: 20 }, { ticker: "MCD", weight: 20 }] },
  { slug: "us-broad-market", name: "US Broad Market", blurb: "The whole US market in three ETFs.", legs: [{ ticker: "SPY", weight: 50 }, { ticker: "QQQ", weight: 30 }, { ticker: "IWM", weight: 20 }] },
];

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
