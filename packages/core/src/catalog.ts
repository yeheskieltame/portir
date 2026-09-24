/** Curated baskets (PRD F4): transparent, static weights. Shared by the app and the executor. */
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

/** Legs of a plan target: a ticker, or "BASKET:<name>" expanded to its weights (null if the basket is unknown). */
export function targetLegs(target: string): { ticker: string; weight: number }[] | null {
  if (!target.startsWith("BASKET:")) return [{ ticker: target, weight: 1 }];
  const b = BASKETS.find((x) => x.name === target.slice(7));
  if (!b) return null;
  const total = b.legs.reduce((n, l) => n + l.weight, 0);
  return b.legs.map((l) => ({ ticker: l.ticker, weight: l.weight / total }));
}
