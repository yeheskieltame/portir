import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { guard } from "./index.ts";
import { BinanceApiError, type StockToken, assetStatus, listStocks, quote, quoteStock } from "./binance.ts";

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

const TOKEN: StockToken = { chainId: "56", contractAddress: "0xabc", symbol: "NVDAon", ticker: "NVDA", issuer: "ondo" };
const dynamic = (stockPrice: string | null) => ({
  symbol: "NVDAon",
  ticker: "NVDA",
  tokenInfo: { price: "310.384196924055952519", sharesMultiplier: "1.001084338309087472" },
  stockInfo: { price: stockPrice },
  statusInfo: { openState: true, marketStatus: "regular", reasonCode: "TRADING" },
});
const closed = { openState: false, marketStatus: "closed", reasonCode: "MARKET_CLOSED", reasonMsg: null, nextOpenTime: 1774252860000, nextCloseTime: 1774272540000 };

test("listStocks keeps the requested chain and the three stock issuers", async () => {
  const row = (chainId: string, type: number, symbol: string) => ({ chainId, type, symbol, ticker: "NVDA", contractAddress: symbol, multiplier: "1" });
  stub({ "stock/detail/list": [row("1", 1, "eth"), row("56", 1, "NVDAon"), row("56", 2, "NVDAx"), row("56", 3, "NVDAB"), row("56", 4, "xOPAI")] });
  const stocks = await listStocks();
  assert.deepEqual(stocks.map((s) => [s.symbol, s.issuer]), [["NVDAon", "ondo"], ["NVDAx", "xstocks"], ["NVDAB", "bstocks"]]);
  assert.match(calls[0], /\/v1\/public\/.*\/rwa\/stock\/detail\/list\/ai$/);
});

test("assetStatus: after hours is not a halt, corporate actions are", async () => {
  stub({ "asset/market/status": closed });
  const s = await assetStatus(TOKEN);
  assert.deepEqual([s.open, s.session, s.halted], [false, "closed", undefined]);

  stub({ "asset/market/status": { openState: true, marketStatus: null, reasonCode: "TRADING" } }); // xStocks, bStocks
  assert.equal((await assetStatus(TOKEN)).session, null);
  assert.equal(s.nextOpenAt?.toISOString(), "2026-03-23T08:01:00.000Z");

  stub({ "asset/market/status": { openState: false, marketStatus: "pause", reasonCode: "ASSET_PAUSED", reasonMsg: "cash_dividend" } });
  assert.equal((await assetStatus(TOKEN)).halted, "cash_dividend");

  stub({ "asset/market/status": { openState: true, marketStatus: "regular", reasonCode: "ASSET_LIMITED", reasonMsg: "earnings" } });
  assert.deepEqual(await assetStatus(TOKEN).then((x) => [x.session, x.halted]), ["open", "earnings"]);

  stub({ "asset/market/status": { openState: true, marketStatus: "overnight", reasonCode: "TRADING" } });
  assert.deepEqual(await assetStatus(TOKEN).then((x) => [x.open, x.session, x.halted]), [true, "closed", undefined]);
});

test("quote converts token price to per-share and feeds the Guard", async () => {
  stub({ "rwa/dynamic": dynamic("309.10") });
  const q = await quote(TOKEN);
  assert.equal(calls.length, 1);
  assert.deepEqual([q.issuer, q.session], ["ondo", "open"]);
  assert.ok(Math.abs(q.onchain - 310.384196924055952519 / 1.001084338309087472) < 1e-9);
  assert.equal(q.reference, 309.1);
  assert.match(calls.find((c) => c.includes("dynamic"))!, /\/v2\/public\//);
  assert.equal(guard({ ...q, session: q.session!, reference: q.reference! }).verdict, "GO"); // 310.05 vs 309.10 = 0.31%
});

test("quote keeps a null exchange price as null instead of inventing one", async () => {
  stub({ "rwa/dynamic": dynamic(null) });
  assert.equal((await quote(TOKEN)).reference, null);
});

// Live NVDA values captured 2026-09-21 during the regular session.
test("quoteStock shares the exchange price across issuers and puts the cheapest tradable one first", async () => {
  const live: Record<string, unknown> = {
    on: { tokenInfo: { price: "223.227234617942346981", sharesMultiplier: "1.0017152487959898" }, stockInfo: { price: "222.765" }, statusInfo: { openState: true, marketStatus: "regular", reasonCode: "TRADING" } },
    x: { tokenInfo: { price: "224.642062627314875866", sharesMultiplier: "1.0009180758490996" }, stockInfo: { price: "222.765" }, statusInfo: { openState: true, marketStatus: null, reasonCode: "TRADING" } },
    b: { tokenInfo: { price: "223.04344272778828887255", sharesMultiplier: "1.000778223752807865" }, stockInfo: { price: null }, statusInfo: { openState: true, marketStatus: null, reasonCode: "TRADING" } },
  };
  globalThis.fetch = (async (u: URL) => Response.json({ success: true, data: live[u.searchParams.get("contractAddress")!] })) as typeof fetch;
  const t = (contractAddress: string, issuer: StockToken["issuer"]): StockToken => ({ ...TOKEN, contractAddress, issuer });

  const view = await quoteStock([t("x", "xstocks"), t("b", "bstocks"), t("on", "ondo")]);
  assert.deepEqual([view.session, view.reference], ["open", 222.765]);
  assert.deepEqual(view.offers.map((o) => [o.issuer, o.spreadBps]), [["ondo", 3.59], ["bstocks", 4.71], ["xstocks", 75.01]]);

  (live.on as any).statusInfo = { openState: false, marketStatus: "pause", reasonCode: "ASSET_PAUSED", reasonMsg: "stock_split" };
  assert.deepEqual((await quoteStock([t("on", "ondo"), t("b", "bstocks")])).offers.map((o) => o.issuer), ["bstocks", "ondo"]);

  // Live TSLAx: 1.72% under the exchange price. Looks cheapest, is stale, must not be routed to first.
  (live.x as any).tokenInfo = { price: "218.93", sharesMultiplier: "1" };
  assert.deepEqual((await quoteStock([t("x", "xstocks"), t("b", "bstocks")])).offers.map((o) => o.issuer), ["bstocks", "xstocks"]);

  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  await assert.rejects(quoteStock([t("on", "ondo")]), BinanceApiError);
});

test("bad payloads fail loudly", async () => {
  stub({});
  await assert.rejects(listStocks(), BinanceApiError); // HTTP 404

  globalThis.fetch = (async () => Response.json({ code: "100001", success: false, message: "illegal parameter" })) as typeof fetch;
  await assert.rejects(assetStatus(TOKEN), /100001 illegal parameter/);

  stub({ "rwa/dynamic": { ...dynamic("1"), tokenInfo: { price: "abc", sharesMultiplier: "1" } } });
  await assert.rejects(quote(TOKEN), /tokenInfo.price/);

  stub({ "rwa/dynamic": { ...dynamic("1"), tokenInfo: { price: "10", sharesMultiplier: "0" } } });
  await assert.rejects(quote(TOKEN), /sharesMultiplier/);
});

test("klines: candles parse per the API 6 array layout", async () => {
  const { klines, meta } = await import("./binance.ts");
  stub({
    "dex/market/token/kline": { klineInfos: [[1773619200000, "302.9", "306.9", "302.2", "305.2", "0", 1773705599999]], decimals: 5 },
    "rwa/meta": { name: "NVIDIA (Ondo)", icon: "/images/x.png", companyInfo: { companyName: "Nvidia Corp", industry: "Technology", ceo: "Jensen Huang", description: "GPUs.", homepageUrl: "" } },
  });
  assert.deepEqual(await klines(TOKEN, "1d", 1), [{ t: 1773619200000, o: 302.9, h: 306.9, l: 302.2, c: 305.2 }]);
  assert.match(calls[0], /interval=1d&limit=1/);
  const m = await meta(TOKEN);
  assert.equal(m.icon, "https://bin.bnbstatic.com/images/x.png");
  assert.deepEqual(m.company, { name: "Nvidia Corp", industry: "Technology", ceo: "Jensen Huang", description: "GPUs.", homepage: null });
});
