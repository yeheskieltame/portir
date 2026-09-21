import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { guard } from "./index.ts";
import { BinanceApiError, assetStatus, listStocks, quote } from "./binance.ts";

// Response bodies below are the samples from the official SKILL.md v1.1, with placeholders filled in.
const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));

const calls: string[] = [];
function stub(routes: Record<string, unknown>) {
  calls.length = 0;
  globalThis.fetch = (async (input: URL) => {
    calls.push(input.toString());
    const hit = Object.keys(routes).find((k) => input.pathname.includes(k));
    if (!hit) return new Response("", { status: 404 });
    return Response.json({ code: "000000", success: true, data: routes[hit] });
  }) as typeof fetch;
}

const TOKEN = { chainId: "56", contractAddress: "0xabc" };
const dynamic = (stockPrice: string | null) => ({
  symbol: "NVDAon",
  ticker: "NVDA",
  tokenInfo: { price: "310.384196924055952519", sharesMultiplier: "1.001084338309087472" },
  stockInfo: { price: stockPrice },
  statusInfo: { openState: null, marketStatus: null, reasonCode: null },
});
const closed = { openState: false, marketStatus: "closed", reasonCode: "MARKET_CLOSED", reasonMsg: null, nextOpenTime: 1774252860000, nextCloseTime: 1774272540000 };

test("listStocks keeps only the requested chain and parses the multiplier", async () => {
  stub({
    "stock/detail/list": [
      { chainId: "1", contractAddress: "0x1", symbol: "NVDAon", ticker: "NVDA", type: 1, multiplier: "1.02" },
      { chainId: "56", contractAddress: "0x2", symbol: "NVDAon", ticker: "NVDA", type: 1, multiplier: "1.010063782256545489" },
    ],
  });
  const stocks = await listStocks();
  assert.deepEqual(stocks.map((s) => s.contractAddress), ["0x2"]);
  assert.equal(stocks[0].multiplier, 1.0100637822565455);
  assert.match(calls[0], /\/v1\/public\/.*\/rwa\/stock\/detail\/list\/ai\?type=1$/);
});

test("assetStatus: after hours is not a halt, corporate actions are", async () => {
  stub({ "asset/market/status": closed });
  const s = await assetStatus(TOKEN);
  assert.deepEqual([s.open, s.session, s.halted], [false, "closed", undefined]);
  assert.equal(s.nextOpenAt?.toISOString(), "2026-03-23T08:01:00.000Z");

  stub({ "asset/market/status": { openState: false, marketStatus: "pause", reasonCode: "ASSET_PAUSED", reasonMsg: "cash_dividend" } });
  assert.equal((await assetStatus(TOKEN)).halted, "cash_dividend");

  stub({ "asset/market/status": { openState: true, marketStatus: "regular", reasonCode: "ASSET_LIMITED", reasonMsg: "earnings" } });
  assert.deepEqual(await assetStatus(TOKEN).then((x) => [x.session, x.halted]), ["open", "earnings"]);

  stub({ "asset/market/status": { openState: true, marketStatus: "overnight", reasonCode: "TRADING" } });
  assert.deepEqual(await assetStatus(TOKEN).then((x) => [x.open, x.session, x.halted]), [true, "closed", undefined]);
});

test("quote converts token price to per-share and feeds the Guard", async () => {
  stub({ "rwa/dynamic": dynamic("309.10"), "asset/market/status": { openState: true, marketStatus: "regular", reasonCode: "TRADING" } });
  const q = await quote(TOKEN);
  assert.ok(Math.abs(q.onchain - 310.384196924055952519 / 1.001084338309087472) < 1e-9);
  assert.equal(q.reference, 309.1);
  assert.match(calls.find((c) => c.includes("dynamic"))!, /\/v2\/public\//);
  assert.equal(guard({ ...q, reference: q.reference! }).verdict, "GO"); // 310.05 vs 309.10 = 0.31%
});

test("quote keeps a null exchange price as null instead of inventing one", async () => {
  stub({ "rwa/dynamic": dynamic(null), "asset/market/status": closed });
  assert.equal((await quote(TOKEN)).reference, null);
});

test("bad payloads fail loudly", async () => {
  stub({});
  await assert.rejects(listStocks(), BinanceApiError); // HTTP 404

  globalThis.fetch = (async () => Response.json({ code: "100001", success: false, message: "illegal parameter" })) as typeof fetch;
  await assert.rejects(assetStatus(TOKEN), /100001 illegal parameter/);

  stub({ "rwa/dynamic": { ...dynamic("1"), tokenInfo: { price: "abc", sharesMultiplier: "1" } }, "asset/market/status": closed });
  await assert.rejects(quote(TOKEN), /tokenInfo.price/);

  stub({ "rwa/dynamic": { ...dynamic("1"), tokenInfo: { price: "10", sharesMultiplier: "0" } }, "asset/market/status": closed });
  await assert.rejects(quote(TOKEN), /sharesMultiplier/);
});
