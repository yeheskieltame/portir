// Live check against the real API: pnpm --filter @portir/core smoke [TICKER]
import { listStocks, marketStatus, quoteStock } from "./binance.ts";

const ticker = process.argv[2] ?? "NVDA";
const stocks = await listStocks();
const count = (issuer: string) => stocks.filter((s) => s.issuer === issuer).length;
console.log(`BSC: ${count("ondo")} ondo, ${count("xstocks")} xstocks, ${count("bstocks")} bstocks`);
console.log("market:", await marketStatus());

const tokens = stocks.filter((s) => s.ticker === ticker);
if (tokens.length === 0) throw new Error(`${ticker} is not listed on BSC`);
console.log(await quoteStock(tokens));
