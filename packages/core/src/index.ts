// @portir/core: the Guard. Pure decision logic from PRD §6, shared by the app, the MCP server and the
// executor agent. No I/O in here: callers fetch market data (Binance Web3 APIs) and pass it in.
// ponytail: one file, erasable-only TS, so Node runs it as-is and Next transpiles it; no build step.

export type Session = "open" | "pre" | "after" | "closed";
export type Verdict = "GO" | "WARN" | "BLOCK";

/** PRD §6 thresholds, in basis points. v1, tunable. */
export const THRESHOLDS = { warnBps: 50, blockBps: 100, simulationBps: 30 } as const;

export interface MarketSnapshot {
  session: Session;
  /** Set when the issuer halted the asset (earnings, dividend, split); the value is the reason code. */
  halted?: string;
  /** On-chain price in USD. */
  onchain: number;
  /** Exchange reference price in USD. */
  reference: number;
}

export interface Decision {
  verdict: Verdict;
  spreadBps: number;
  /** One plain-language sentence (PRD principle 3). */
  reason: string;
}

/** Premium of `price` over `reference` in basis points, rounded to 0.01 bps so 0.5% is exactly 50. */
export function spreadBps(price: number, reference: number): number {
  if (!(price > 0) || !(reference > 0)) throw new RangeError("prices must be positive numbers");
  return Math.round(((price - reference) / reference) * 1e6) / 100;
}

const pct = (bps: number) => `${(Math.abs(bps) / 100).toFixed(2)}%`;

/**
 * Buy-side verdict. Only a premium counts against the order: a discount to the exchange price is
 * in the buyer's favour. Sells will need the mirror image when they exist.
 */
export function guard(m: MarketSnapshot): Decision {
  const bps = spreadBps(m.onchain, m.reference);
  const when = m.session === "open" ? "The market is open" : "The market is closed";

  if (m.halted) {
    return { verdict: "BLOCK", spreadBps: bps, reason: `Trading is paused for this stock (${m.halted}).` };
  }
  if (bps > THRESHOLDS.blockBps) {
    return {
      verdict: "BLOCK",
      spreadBps: bps,
      reason: `${when} and the on-chain price is ${pct(bps)} above the exchange price, so it is better to wait.`,
    };
  }
  if (bps > THRESHOLDS.warnBps) {
    return {
      verdict: "WARN",
      spreadBps: bps,
      reason: `${when} and you would pay ${pct(bps)} more than the exchange price.`,
    };
  }
  return {
    verdict: "GO",
    spreadBps: bps,
    reason:
      bps > 0
        ? `${when} and the price is fair (${pct(bps)} above the exchange price).`
        : `${when} and the price is at or below the exchange price.`,
  };
}

/** PRD step 4: reject when the simulated fill is more than 0.3% worse than the quote. */
export function simulationOk(quotedPrice: number, simulatedPrice: number): boolean {
  return spreadBps(simulatedPrice, quotedPrice) <= THRESHOLDS.simulationBps;
}

export interface IssuerQuote {
  issuer: string;
  halted?: string;
  spreadBps: number;
  /** Quoted price impact for the order size, in bps. */
  impactBps: number;
  volume24hUsd: number;
}

/** PRD issuer scoring: lowest spread + impact wins, halted issuers are out, ties go to 24h volume. */
export function pickIssuer<Q extends IssuerQuote>(quotes: readonly Q[]): Q | undefined {
  const cost = (q: IssuerQuote) => q.spreadBps + q.impactBps;
  return quotes
    .filter((q) => !q.halted)
    .sort((a, b) => cost(a) - cost(b) || b.volume24hUsd - a.volume24hUsd)[0];
}
