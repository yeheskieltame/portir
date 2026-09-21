import type { Session } from "@portir/core";

export interface Stock {
  ticker: string;
  name: string;
  session: Session;
  halted?: string;
  onchain: number;
  /** null when the exchange price is unavailable (the API returns none outside trading hours). */
  reference: number | null;
  /** Every issuer's price for this stock, best first. `onchain` above is the first one. */
  offers?: { issuer: string; onchain: number; spreadBps: number | null; halted?: string }[];
}

// Curated list (PRD: 6-8 liquid tickers). Names are ours: principle 1, "stocks, not tokens".
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

export const BASKETS = ["AI & Semis", "Big Tech", "Dividend Blue-chips", "US Broad Market"];

// Made-up prices that exercise every Guard verdict. Shown only when live data is unreachable, and labelled.
export const SAMPLE_STOCKS: Stock[] = [
  { ticker: "NVDA", name: "NVIDIA", session: "closed", onchain: 191.2, reference: 191.05 },
  { ticker: "TSLA", name: "Tesla", session: "closed", onchain: 352.1, reference: 348.9 },
  { ticker: "AAPL", name: "Apple", session: "closed", onchain: 243.6, reference: 240.3 },
  { ticker: "MSFT", name: "Microsoft", session: "closed", onchain: 512.0, reference: null },
  { ticker: "QQQ", name: "Nasdaq 100 ETF", session: "closed", onchain: 601.3, reference: 600.2 },
  { ticker: "SPY", name: "S&P 500 ETF", session: "closed", halted: "cash_dividend", onchain: 668.1, reference: 668.0 },
];
