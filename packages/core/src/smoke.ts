// Live check against the real API: pnpm --filter @portir/core smoke [TICKER]
import { listStocks, marketStatus, quote } from "./binance.ts";
import { guard } from "./index.ts";

const ticker = process.argv[2] ?? "NVDA";
const stocks = await listStocks();
console.log(`${stocks.length} Ondo stocks on BSC`, stocks.slice(0, 8).map((s) => s.ticker).join(" "));
console.log("market:", await marketStatus());

const token = stocks.find((s) => s.ticker === ticker);
if (!token) throw new Error(`${ticker} is not listed on BSC`);
const q = await quote(token);
console.log(q);
console.log(q.reference === null ? "no exchange price right now" : guard({ ...q, reference: q.reference }));
