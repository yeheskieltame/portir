import type { MarketSnapshot } from "@portir/core";

export interface Stock extends MarketSnapshot {
  ticker: string;
  name: string;
}

// SAMPLE DATA. Replaced by RWA Data + Market API reads once tickers are verified on BSC (PRD day 1-3).
// Prices are made up to exercise every Guard verdict; the UI labels them as sample.
export const SAMPLE_STOCKS: Stock[] = [
  { ticker: "NVDA", name: "NVIDIA", session: "closed", onchain: 191.2, reference: 191.05 },
  { ticker: "TSLA", name: "Tesla", session: "closed", onchain: 352.1, reference: 348.9 },
  { ticker: "AAPL", name: "Apple", session: "closed", onchain: 243.6, reference: 240.3 },
  { ticker: "MSFT", name: "Microsoft", session: "closed", onchain: 512.0, reference: 512.4 },
  { ticker: "QQQ", name: "Nasdaq 100 ETF", session: "closed", onchain: 601.3, reference: 600.2 },
  { ticker: "KO", name: "Coca-Cola", session: "closed", halted: "dividend", onchain: 68.1, reference: 68.0 },
];

export const BASKETS = ["AI & Semis", "Big Tech", "Dividend Blue-chips", "US Broad Market"];
