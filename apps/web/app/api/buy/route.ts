import { guard, isSuspectDiscount, spreadBps } from "@portir/core";
import { quoteStock } from "@portir/core/binance";
import { USDT, createTrader, quoteEnvelope, usdt } from "@portir/core/trading";
import { createPublicClient, encodeFunctionData, erc20Abi, http, isAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { NA_REASON } from "@/app/verdict";
import { tokenList } from "@/lib/live";
import { asMode } from "@/lib/mode";
import { QUOTE_DOMAIN, QUOTE_TYPES, TESTNET, testExchangeAbi } from "@/lib/testnet";

export const dynamic = "force-dynamic";

const MAX_USDT = 10_000;

export interface BuyResponse {
  verdict: "GO" | "WARN" | "BLOCK";
  reason: string;
  spreadBps: number | null;
  reference: number | null;
  chainId: number;
  issuer?: string;
  vendor?: string;
  pricePerShare?: number;
  impactBps?: number | null;
  /** Expected and guaranteed-minimum shares (raw tokens × multiplier). */
  shares?: number;
  minShares?: number;
  token?: string;
  /** Send in order: approvals first (USDT.approve(spender)), skippable when the allowance already covers `usdt`, then the swap. */
  approvals?: { to: string; data: string; spender: string }[];
  tx?: { to: string; data: string; value: string };
}

// POST /api/buy { ticker, usdt, wallet, mode } → Guard verdict + a ready-to-sign route. Nothing is sent from here: the wallet signs.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; usdt?: number; wallet?: string; mode?: string };
  const ticker = String(body.ticker ?? "").toUpperCase();
  const amount = Number(body.usdt);
  const mode = asMode(body.mode);
  if (!ticker || !(amount >= 1) || amount > MAX_USDT || !body.wallet || !isAddress(body.wallet)) {
    return Response.json({ error: `ticker, wallet and a USDT amount between 1 and ${MAX_USDT} are required` }, { status: 400 });
  }

  try {
    const tokens = (await tokenList()).filter((t) => t.ticker === ticker);
    if (tokens.length === 0) return Response.json({ error: "unknown stock" }, { status: 404 });
    const view = await quoteStock(tokens);
    const session = view.session ?? "closed";
    const reference = view.reference;
    if (mode === "testnet") {
      const offer = view.offers.find((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps)));
      return Response.json(await testnetRoute(ticker, amount, body.wallet, session, reference, offer));
    }
    if (reference === null) return Response.json({ verdict: "BLOCK", reason: NA_REASON, spreadBps: null, reference, chainId: 56 } satisfies BuyResponse);

    const { BINANCE_W3_API_KEY: apiKey = "", BINANCE_W3_API_SECRET: apiSecret = "" } = process.env;
    if (!apiKey || !apiSecret) return Response.json({ error: "Trading API is not configured on this server" }, { status: 503 });

    // PRD step 3: quote the tradable issuers and keep the one that really costs least per share.
    const trader = createTrader({ apiKey, apiSecret });
    const candidates = view.offers.filter((o) => !o.halted && !(o.spreadBps !== null && isSuspectDiscount(o.spreadBps))).slice(0, 2);
    const orders = candidates.map((o) => ({ token: o.contractAddress, multiplier: o.multiplier, usdt: usdt(amount), wallet: body.wallet!, issuer: o.issuer }));
    const quotes = await Promise.allSettled(orders.map((o) => trader.quoteBuy(o)));
    const routed = quotes.flatMap((q, i) => (q.status === "fulfilled" ? [{ order: orders[i], quote: q.value }] : []));
    if (routed.length === 0) {
      const halted = view.offers.find((o) => o.halted)?.halted;
      // The SDK hides the API's error envelope; ask once more without it so the reason is visible.
      const raw = await quoteEnvelope({ apiKey, apiSecret }, orders[0]).catch((e) => ({ status: 0, code: undefined, msg: String(e) }));
      const detail = `${quotes.flatMap((q) => (q.status === "rejected" ? [q.reason instanceof Error ? q.reason.message : String(q.reason)] : [])).join("; ")} | api: ${JSON.stringify({ status: raw.status, code: raw.code, msg: raw.msg })}`;
      console.error("buy api: no route:", detail);
      // 40304: Binance refuses trading calls from cloud/datacenter IPs. Works from a home connection; see DEVEX_REPORT.
      const reason = halted
        ? `Trading is paused for this stock (${halted}).`
        : String(raw.code) === "40304"
          ? "Binance's trading service refuses requests from this server's network (compliance restriction). Prices are live, but orders must be quoted from an allowed network."
          : "No provider can fill this order right now.";
      return Response.json({ verdict: "BLOCK", reason, spreadBps: null, reference, chainId: 56, detail } satisfies BuyResponse & { detail: string });
    }
    routed.sort((a, b) => a.quote.pricePerShare - b.quote.pricePerShare);
    const { order, quote } = routed[0];

    const decision = guard({ session, onchain: quote.pricePerShare, reference });
    const base: BuyResponse = {
      verdict: decision.verdict,
      reason: decision.reason,
      spreadBps: spreadBps(quote.pricePerShare, reference),
      reference,
      chainId: 56,
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
      approvals: built.approvals.map((a) => JSON.parse(a) as { approveContract: string; approveTxCalldata: string }).map((a) => ({ to: USDT, data: a.approveTxCalldata, spender: a.approveContract })),
      tx: { to: built.tx.to, data: built.tx.data, value: built.tx.value },
    } satisfies BuyResponse);
  } catch (e) {
    console.error("buy api:", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

const QUOTE_TTL = 10 * 60; // seconds a signed testnet quote stays valid

/**
 * Testnet: the same Guard on the same live mainnet data; only settlement differs. The best mainnet
 * offer's price is signed as an EIP-712 quote the TestExchange honours until the deadline, so the
 * trade fills at exactly the price the Guard judged, with tUSDT on BSC testnet.
 */
async function testnetRoute(ticker: string, amount: number, wallet: string, session: "open" | "pre" | "after" | "closed", reference: number | null, offer: { onchain: number; issuer: string } | undefined): Promise<BuyResponse | { error: string }> {
  const stock = TESTNET.stocks[ticker];
  if (!stock) return { error: `${ticker} is not on the testnet exchange yet. Switch to mainnet mode for the full list.` };
  const chainId = bscTestnet.id;
  if (!offer || reference === null) return { verdict: "BLOCK", reason: NA_REASON, spreadBps: null, reference, chainId, issuer: "testnet", pricePerShare: offer?.onchain };
  const key = process.env.TESTNET_KEEPER_KEY;
  if (!key) return { error: "Testnet quotes are not configured on this server (TESTNET_KEEPER_KEY)" };
  const pc = createPublicClient({ chain: bscTestnet, transport: http(process.env.NEXT_PUBLIC_RPC_URL) });
  const feeBps = await pc.readContract({ address: TESTNET.exchange, abi: testExchangeAbi, functionName: "feeBps" });
  const onchain = offer.onchain;
  const decision = guard({ session, onchain, reference });
  const usdtIn = parseUnits(amount.toFixed(6), 18);
  const shares = (amount * (10_000 - feeBps)) / 10_000 / onchain;
  const minShares = shares * 0.995;
  const base: BuyResponse = { verdict: decision.verdict, reason: decision.reason, spreadBps: decision.spreadBps, reference, chainId, issuer: offer.issuer, vendor: "TestExchange", pricePerShare: onchain, impactBps: 0, shares, token: stock };
  if (decision.verdict === "BLOCK") return base;
  const price = parseUnits(onchain.toFixed(6), 18);
  const deadline = Math.floor(Date.now() / 1000) + QUOTE_TTL;
  const sig = await privateKeyToAccount(key as `0x${string}`).signTypedData({ domain: QUOTE_DOMAIN, types: QUOTE_TYPES, primaryType: "Quote", message: { stock, price, deadline } });
  return {
    ...base,
    minShares,
    approvals: [{ to: TESTNET.usdt, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TESTNET.exchange, usdtIn] }), spender: TESTNET.exchange }],
    tx: { to: TESTNET.exchange, data: encodeFunctionData({ abi: testExchangeAbi, functionName: "buy", args: [stock, usdtIn, parseUnits(minShares.toFixed(18), 18), price, deadline, sig] }), value: "0" },
  };
}
