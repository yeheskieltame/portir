// Live, read-only check of the Trading API: pnpm --filter @portir/core smoke:trade [TICKER] [USDT]
// Quotes only. Nothing is signed or sent, so no funds are needed.
import { listStocks, quote } from "./binance.ts";
import { guard, spreadBps } from "./index.ts";
import { createTrader, usdt } from "./trading.ts";

const [ticker = "NVDA", amount = "10"] = process.argv.slice(2);
const wallet = process.env.SMOKE_WALLET ?? "0xbe3C7a9cA244b35df7Ee9E6af637bdeF94c3879e";
const trader = createTrader({ apiKey: process.env.BINANCE_W3_API_KEY ?? "", apiSecret: process.env.BINANCE_W3_API_SECRET ?? "" });

const tokens = (await listStocks()).filter((s) => s.ticker === ticker);
const quotes = await Promise.all(tokens.map(quote));
const reference = quotes.find((q) => q.reference !== null)?.reference ?? null;
console.log(`${ticker}: exchange ${reference}, buying ${amount} USDT from ${wallet}\n`);

for (const [i, token] of tokens.entries()) {
  const oracle = quotes[i];
  try {
    const order = { token: token.contractAddress, multiplier: oracle.multiplier, usdt: usdt(Number(amount)), wallet };
    const q = await trader.quoteBuy(order);
    console.log(token.issuer, {
      vendor: q.vendor,
      mode: q.mode,
      oraclePerShare: oracle.onchain,
      executablePerShare: q.pricePerShare,
      executableVsExchangeBps: reference === null ? null : spreadBps(q.pricePerShare, reference),
      impactBps: q.impactBps,
      approveTarget: q.approveTarget,
    });
    if (reference !== null) console.log("  guard:", guard({ session: oracle.session ?? "closed", halted: oracle.halted, onchain: q.pricePerShare, reference }).reason);

    const built = await trader.buildBuy(order, q);
    console.log("  build:", { hasTx: !!built.tx, rfqVendor: built.rfq?.vendor, scheme: built.rfq?.signingScheme, typedDataChars: built.rfq?.typedDataToSign.length, approvals: built.approvals.length, minTokensOut: built.minTokensOut });
  } catch (e) {
    console.log(token.issuer, "FAILED:", e instanceof Error ? e.message : e);
  }
}
