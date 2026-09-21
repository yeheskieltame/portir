import "server-only";
import { listStocks, quote } from "@portir/core/binance";
import { SAMPLE_STOCKS, STOCK_NAMES, type Stock } from "./catalog";

export interface Catalog {
  stocks: Stock[];
  /** Set when live data could not be loaded and `stocks` is sample data. */
  error?: string;
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const tokens = (await listStocks()).filter((t) => t.ticker in STOCK_NAMES);
    if (tokens.length === 0) throw new Error("none of the curated tickers are listed on BSC");

    const results = await Promise.allSettled(tokens.map(quote));
    const stocks = results.flatMap((r, i) => {
      if (r.status === "rejected") {
        console.error(`quote ${tokens[i].ticker}:`, r.reason);
        return [];
      }
      return [{ ...r.value, name: STOCK_NAMES[r.value.ticker] ?? r.value.ticker }];
    });
    if (stocks.length === 0) throw new Error("every price request failed");
    return { stocks };
  } catch (e) {
    console.error("live catalog unavailable:", e);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return { stocks: SAMPLE_STOCKS, error: `${e instanceof Error ? e.message : e}${cause}` };
  }
}
