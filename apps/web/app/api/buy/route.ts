import { guard, isSuspectDiscount, spreadBps } from "@portir/core";
import { listStocks, quoteStock } from "@portir/core/binance";
import { USDT, createTrader, usdt } from "@portir/core/trading";
import { isAddress } from "viem";
import { NA_REASON } from "@/app/verdict";

export const dynamic = "force-dynamic";

const MAX_USDT = 10_000;

export interface BuyResponse {
  verdict: "GO" | "WARN" | "BLOCK";
  reason: string;
  spreadBps: number | null;
  reference: number | null;
  issuer?: string;
  vendor?: string;
  pricePerShare?: number;
  impactBps?: number | null;
  /** Expected and guaranteed-minimum shares (raw tokens × multiplier). */
  shares?: number;
  minShares?: number;
  token?: string;
  /** Send in order: approvals first (USDT.approve), then the swap. */
  approvals?: { to: string; data: string }[];
  tx?: { to: string; data: string; value: string };
}

// POST /api/buy { ticker, usdt, wallet } → Guard verdict + a ready-to-sign route. Nothing is sent from here: the wallet signs.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; usdt?: number; wallet?: string };
  const ticker = String(body.ticker ?? "").toUpperCase();
  const amount = Number(body.usdt);
  if (!ticker || !(amount >= 1) || amount > MAX_USDT || !body.wallet || !isAddress(body.wallet)) {
    return Response.json({ error: `ticker, wallet and a USDT amount between 1 and ${MAX_USDT} are required` }, { status: 400 });
  }
  const { BINANCE_W3_API_KEY: apiKey = "", BINANCE_W3_API_SECRET: apiSecret = "" } = process.env;
  if (!apiKey || !apiSecret) return Response.json({ error: "Trading API is not configured on this server" }, { status: 503 });

  try {
    const tokens = (await listStocks()).filter((t) => t.ticker === ticker);
    if (tokens.length === 0) return Response.json({ error: "unknown stock" }, { status: 404 });
    const view = await quoteStock(tokens);
    const session = view.session ?? "closed";
    const reference = view.reference;
    if (reference === null) return Response.json({ verdict: "BLOCK", reason: NA_REASON, spreadBps: null, reference } satisfies BuyResponse);

    // PRD step 3: quote the tradable issuers and keep the one that really costs least per share.
    const trader = createTrader({ apiKey, apiSecret });
    const candidates = view.offers.filter((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps))).slice(0, 2);
    const orders = candidates.map((o) => ({ token: o.contractAddress, multiplier: o.multiplier, usdt: usdt(amount), wallet: body.wallet!, issuer: o.issuer }));
    const quotes = await Promise.allSettled(orders.map((o) => trader.quoteBuy(o)));
    const routed = quotes.flatMap((q, i) => (q.status === "fulfilled" ? [{ order: orders[i], quote: q.value }] : []));
    if (routed.length === 0) {
      const halted = view.offers.find((o) => o.halted)?.halted;
      return Response.json({ verdict: "BLOCK", reason: halted ? `Trading is paused for this stock (${halted}).` : "No provider can fill this order right now.", spreadBps: null, reference } satisfies BuyResponse);
    }
    routed.sort((a, b) => a.quote.pricePerShare - b.quote.pricePerShare);
    const { order, quote } = routed[0];

    const decision = guard({ session, onchain: quote.pricePerShare, reference });
    const base: BuyResponse = {
      verdict: decision.verdict,
      reason: decision.reason,
      spreadBps: spreadBps(quote.pricePerShare, reference),
      reference,
      issuer: order.issuer,
      vendor: quote.vendor,
      pricePerShare: quote.pricePerShare,
      impactBps: quote.impactBps,
      shares: (Number(quote.tokensOut) / 1e18) * order.multiplier,
      token: order.token,
    };
    if (decision.verdict === "BLOCK") return Response.json(base);

    const built = await trader.buildBuy(order, quote);
    if (!built.tx) return Response.json({ error: "This provider only offers RFQ orders, which the app cannot sign yet" }, { status: 501 });
    return Response.json({
      ...base,
      minShares: built.minTokensOut ? (Number(built.minTokensOut) / 1e18) * order.multiplier : undefined,
      approvals: built.approvals.map((a) => JSON.parse(a) as { approveContract: string; approveTxCalldata: string }).map((a) => ({ to: USDT, data: a.approveTxCalldata })),
      tx: { to: built.tx.to, data: built.tx.data, value: built.tx.value },
    } satisfies BuyResponse);
  } catch (e) {
    console.error("buy api:", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
