import "server-only";
import { listStocks, quoteStock } from "@portir/core/binance";
import { SAMPLE_STOCKS, STOCK_NAMES, type Stock } from "./catalog";

export interface Catalog {
  stocks: Stock[];
  /** Set when live data could not be loaded and `stocks` is sample data. */
  error?: string;
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const tokens = await listStocks();
    const tickers = Object.keys(STOCK_NAMES).filter((ticker) => tokens.some((t) => t.ticker === ticker));
    if (tickers.length === 0) throw new Error("none of the curated tickers are listed on BSC");

    const results = await Promise.allSettled(tickers.map((ticker) => quoteStock(tokens.filter((t) => t.ticker === ticker))));
    const stocks = results.flatMap((r, i): Stock[] => {
      if (r.status === "rejected") {
        console.error(`quote ${tickers[i]}:`, r.reason);
        return [];
      }
      const [best] = r.value.offers;
      return [
        {
          ticker: r.value.ticker,
          name: STOCK_NAMES[r.value.ticker],
          // No issuer reported a session: assume closed, the cautious reading for the Guard's wording.
          session: r.value.session ?? "closed",
          halted: best.halted,
          onchain: best.onchain,
          reference: r.value.reference,
          offers: r.value.offers,
        },
      ];
    });
    if (stocks.length === 0) throw new Error("every price request failed");
    return { stocks };
  } catch (e) {
    console.error("live catalog unavailable:", e);
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return { stocks: SAMPLE_STOCKS, error: `${e instanceof Error ? e.message : e}${cause}` };
  }
}
