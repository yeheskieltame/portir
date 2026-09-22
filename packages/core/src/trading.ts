// Binance Web3 Trading + Transaction API, through the official SDK (it owns request signing).
// BSC mainnet only: stock tokens have no testnet. Quoting is read-only and free.
// Server-side only: needs the API secret.
import { Web3Wallet } from "@binance-web3/wallet";
import { BSC } from "./binance.ts";
import { spreadBps } from "./index.ts";

export const USDT = "0x55d398326f99059fF775485246999027B3197955"; // BSC USDT, 18 decimals
const UNIT = 10n ** 18n; // USDT and every stock token here use 18 decimals

export class TradingApiError extends Error {}

export interface EvmTx {
  from: string;
  to: string;
  data: string;
  value: string;
}

export interface BuyQuote {
  /** Locks this route for `buildBuy`. */
  quoteId: string;
  vendor: string;
  /** SWAP = ordinary DEX transaction (what Ondo and bStocks return live). RFQ = signed EIP-712 order at a firm price. */
  mode: "RFQ" | "SWAP";
  /** Raw stock-token amount the quote delivers. */
  tokensOut: bigint;
  /** Executable on-chain price per share: what this order really pays, unlike the RWA API's oracle price. */
  pricePerShare: number;
  /** Cost of this order's size vs the market, in bps (positive = worse for the buyer). Null if the vendor gives none. */
  impactBps: number | null;
  /** Contract the wallet must approve USDT to before executing. */
  approveTarget?: string;
}

export interface BuiltBuy {
  minTokensOut?: bigint;
  /** SWAP routes: sign and broadcast. */
  tx?: EvmTx;
  /** RFQ routes: sign `typedDataToSign` with eth_signTypedData_v4 and submit the order. */
  rfq?: { vendor: string; typedDataToSign: string; signingScheme?: string };
  /** JSON strings with the spender and approve() calldata, to send first if the allowance is short. */
  approvals: string[];
}

export function perSharePrice(usdtIn: bigint, tokensOut: bigint, multiplier: number): number {
  if (usdtIn <= 0n || tokensOut <= 0n || !(multiplier > 0)) throw new RangeError("amounts must be positive");
  // Number() on 1e18-scaled bigints keeps ~15 significant digits: fine for a price, never used for amounts.
  return Number(usdtIn) / (Number(tokensOut) * multiplier);
}

/** PRD step 4 on real numbers: did the simulated fill deliver what the quote promised? */
export function fillDeviationBps(quotedOut: bigint, simulatedOut: bigint): number {
  if (simulatedOut <= 0n) return Infinity;
  return spreadBps(Number(quotedOut), Number(simulatedOut));
}

export class NoRouteError extends TradingApiError {}

// The SDK's types promise a { code, success, data } envelope, but `.data()` really returns the inner payload
// (and `null` when no vendor can route the pair). Accept both, in case a release starts matching its types.
async function unwrap<T>(call: Promise<{ data(): Promise<{ success?: boolean; code?: number; msg?: string; data?: T }> }>, what: string): Promise<T> {
  let body: unknown;
  try {
    body = await (await call).data();
  } catch (e) {
    throw new TradingApiError(`${what}: ${e instanceof Error ? e.message : e}`, { cause: e });
  }
  if (body !== null && typeof body === "object" && "success" in body) {
    const envelope = body as { success?: boolean; code?: number; msg?: string; data?: T };
    if (!envelope.success) throw new TradingApiError(`${what}: ${envelope.code ?? ""} ${envelope.msg ?? ""}`.trim());
    body = envelope.data;
  }
  if (body == null || (Array.isArray(body) && body.length === 0)) throw new NoRouteError(`${what}: no route`);
  return body as T;
}

export function createTrader(credentials: { apiKey: string; apiSecret: string }) {
  if (!credentials.apiKey || !credentials.apiSecret) throw new TradingApiError("Binance Web3 API key and secret are required");
  const api = new Web3Wallet({ configurationRestAPI: { ...credentials, timeout: 15_000 } }).restAPI;

  type Order = { token: string; multiplier: number; usdt: bigint; wallet: string };
  const pair = (o: Order) => ({
    binanceChainId: BSC,
    amount: o.usdt.toString(),
    fromTokenAddress: USDT,
    toTokenAddress: o.token,
    userWalletAddress: o.wallet, // required for RFQ routes
  });

  return {
    /** Best executable route across vendors. Read-only: nothing is committed until `buildBuy` + a signature. */
    async quoteBuy(order: Order): Promise<BuyQuote> {
      const routes = await unwrap(api.getAggregatedQuote(pair(order)), "quote");
      const best = routes.find((r) => r.isBest) ?? routes[0];
      if (!best?.quoteId || !best.toTokenAmount) throw new TradingApiError("quote: no route for this pair and size");

      const tokensOut = BigInt(best.toTokenAmount);
      return {
        quoteId: best.quoteId,
        vendor: best.vendorName ?? "unknown",
        mode: best.executionMode === "RFQ" ? "RFQ" : "SWAP",
        tokensOut,
        pricePerShare: perSharePrice(order.usdt, tokensOut, order.multiplier),
        // API: (received - sent) / sent as a percentage, so a loss is negative. Flip it into a cost in bps.
        impactBps: best.priceImpactPercent == null ? null : Math.round(-Number(best.priceImpactPercent) * 1e4) / 100,
        approveTarget: best.approveTarget ?? undefined,
      };
    },

    async buildBuy(order: Order, quote: BuyQuote, slippagePercent = "0.5"): Promise<BuiltBuy> {
      const data = await unwrap(
        api.buildSwapTransaction({ ...pair(order), quoteId: quote.quoteId, slippagePercent, approveTransaction: "true" as never }),
        "build",
      );
      const tx = data.tx?.data && data.tx.to ? { from: data.tx.from ?? order.wallet, to: data.tx.to, data: data.tx.data, value: data.tx.value ?? "0" } : undefined;
      const rfq = data.rfq?.typedDataToSign && data.rfq.vendor ? { vendor: data.rfq.vendor, typedDataToSign: data.rfq.typedDataToSign, signingScheme: data.rfq.signingScheme } : undefined;
      if (!tx && !rfq) throw new TradingApiError("build: neither a transaction nor an RFQ order came back");
      return {
        minTokensOut: data.tx?.minReceiveAmount ? BigInt(data.tx.minReceiveAmount) : undefined,
        tx,
        rfq,
        approvals: data.rfq?.signatureData ?? data.tx?.signatureData ?? [],
      };
    },

    /**
     * Dry-run a SWAP-route tx and return the tokens the wallet would receive.
     * BLOCKED on SDK 12.3.0: it refuses the call unless solTx and tronTx are also passed, and with placeholders the
     * API answers `null`; the SDK drops the error envelope, so the reason is invisible. Until that is fixed this
     * throws, and callers must treat "cannot simulate" as "cannot verify", never as a pass.
     */
    async simulate(tx: EvmTx, token: string): Promise<{ ok: boolean; failReason?: string; tokensOut: bigint }> {
      let data;
      try {
        data = await unwrap(api.simulateTransactions({ binanceChainId: BSC, evmTx: tx, solTx: {}, tronTx: {} } as never), "simulate");
      } catch (e) {
        if (e instanceof NoRouteError) throw new TradingApiError("simulate: the API returned no result (known SDK limitation for EVM-only requests)");
        throw e;
      }
      const received = (data.balanceChanges ?? [])
        .filter((c) => c.contractAddress?.toLowerCase() === token.toLowerCase() && c.owner?.toLowerCase() === tx.from.toLowerCase())
        .reduce((sum, c) => sum + BigInt(c.change ?? "0"), 0n);
      return { ok: data.status !== "FAILED", failReason: data.failReason ?? undefined, tokensOut: received };
    },
  };
}

export const usdt = (amount: number) => BigInt(Math.round(amount * 1e6)) * (UNIT / 10n ** 6n);

const BUILD = "https://web3.binance.com/build";

/**
 * The same signed GET the SDK makes, but returning the raw envelope `{ code, msg, data }` the SDK throws away.
 * Prehash = ISO timestamp + method + "/build" + path?query + body, HMAC-SHA256, base64 (see @binance-web3/common).
 * Use it to learn *why* a quote came back empty.
 */
export async function rawGet(credentials: { apiKey: string; apiSecret: string }, path: string, params: Record<string, string>) {
  const { createHmac } = await import("node:crypto");
  const withQuery = `${path}?${new URLSearchParams(params)}`;
  const timestamp = new Date().toISOString();
  const sign = createHmac("sha256", credentials.apiSecret).update(`${timestamp}GET${new URL(BUILD).pathname}${withQuery}`).digest("base64");
  const res = await fetch(BUILD + withQuery, {
    headers: { "X-OC-APIKEY": credentials.apiKey, "X-OC-SIGN": sign, "X-OC-TIMESTAMP": timestamp, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, ...(JSON.parse(text) as { code?: number | string; msg?: string; data?: unknown }) };
  } catch {
    return { status: res.status, msg: text.slice(0, 200) };
  }
}

/** Raw aggregated quote, for diagnostics when `quoteBuy` reports no route. */
export const quoteEnvelope = (credentials: { apiKey: string; apiSecret: string }, o: { token: string; usdt: bigint; wallet: string }) =>
  rawGet(credentials, "/api/v1/dex/aggregator/quote", { binanceChainId: BSC, amount: o.usdt.toString(), fromTokenAddress: USDT, toTokenAddress: o.token, userWalletAddress: o.wallet });
