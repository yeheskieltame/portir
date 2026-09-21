# Developer Experience Report

PRD F7, 25% of the score. Append as things happen; do not reconstruct from memory later.
Each entry: what we tried, what happened, what we would change.

## Log

### 2026-09-20 (day 1): scaffold

- No Binance Web3 API touched yet. First API entries start with ticker verification (PRD day 1-3).
- Architecture finding: plan storage moved from Postgres to a contract (`PlanRegistry`). With the executor
  on Agent Studio and signing via Agentic Wallet, a backend would only have been a database; the chain
  already is one, and run history with reasons becomes publicly auditable.
- BSC USDT is 18 decimals (Ethereum's is 6). Hard-coded as `USDT_DECIMALS`; easy to get wrong when porting.
- Tooling: `forge init` inside an existing repo creates a nested git repo; flattened to a root submodule.
  `forge lint` left a stale cache that made `forge test` report "No tests found" until `forge clean`.

### 2026-09-21 (day 2): testnet deploy

- `PlanRegistry` UUPS proxy deployed to BSC testnet, 0.00023 tBNB at 0.1 gwei. Cheap enough that storing run
  reasons on-chain is a non-issue.
- An `[etherscan]` block in `foundry.toml` with an unset `${ETHERSCAN_API_KEY}` breaks every `forge verify-contract`,
  even with `--verifier sourcify`. Removed it; forge reads the env var on its own.
- BscScan verification: a free Etherscan v2 key can submit source for chain 97, but `--guess-constructor-args`
  hits an endpoint that is paid-only on BSC ("Free API access is not supported for this chain"). Pass
  `--constructor-args` explicitly; `script/verify.sh` reads them from the broadcast file.
- openzeppelin-foundry-upgrades fails with "Found multiple contracts" unless `forge clean` runs first.
  Baked into `pnpm deploy:*`.

### 2026-09-21 (day 2): RWA Data API client

- Spec source: `binance/binance-skills-hub` → `binance-tokenized-securities-info/SKILL.md` v1.1. Public, no API key,
  clear field tables. The best-documented part of the stack so far.
- **`www.binance.com` is DNS-blocked by Indonesian ISPs** (resolves to a block page IP, plain DNS to 1.1.1.1 is
  intercepted too). Our target user is in Indonesia, so the browser can never call this API; all reads go through
  server components. A docs mirror and an API host outside `binance.com` would help every builder in blocked regions.
- ~~The RWA API covers Ondo only~~ **Wrong, corrected below**: that is what the spec says, not what the API does.
- PRD assumed Ondo rebases. It does not: Ondo uses a `multiplier` (shares per token), growing with reinvested
  dividends, 5.0/10.0 after splits. Per-share price = `tokenInfo.price / sharesMultiplier`.
- `stockInfo.price` is `null` outside trading hours, exactly when the fair-price check matters most. We show
  "exchange price unavailable" rather than invent a reference. Needed: last close + timestamp in that field.
- `tokenInfo.volume24h` is the US stock's USD volume, not on-chain volume (documented, but the name misleads).
- `dynamic` returns `statusInfo` with every field `null` in the sample, so status needs a second call per token.
- `market/status.openState` means "Ondo is tradable" (includes overnight), not "NYSE is open". Session comes only
  from `asset/market/status.marketStatus`.

### 2026-09-21 (day 2, later): first live run (over VPN)

Spec v1.1 vs the live API. Every item below cost us a wrong assumption first.

- **Three issuers, not one.** The spec says `type=1` (Ondo) is "currently the only supported provider". Without the
  filter the list returns 1,922 rows: type 1 Ondo (`NVDAon`, 458 on BSC), type 2 xStocks (`NVDAx`, 128), type 3
  bStocks (`NVDAB`, 77), plus undocumented types 4, 5, 9, 11 and chains `CT_501`, `4663`, `8453`. We mapped 2 and 3
  from token symbols. **Ask: document the `type` enum.** This one line decides whether issuer routing is possible.
- `dynamic.statusInfo` is populated live (the spec sample shows all nulls), so one call per token is enough.
- `market/status` returns undocumented `marketStatus` and an `offhours` object.
- Per-issuer gaps in `dynamic`: only Ondo reports `marketStatus` (xStocks/bStocks: `null`); bStocks has
  `stockInfo.price: null` even in the regular session; `totalHolders`/`marketCap` are `null` for both.
  We take session and exchange price per stock from whichever issuer has them.
- **List vs dynamic multiplier disagree for xStocks**: list says `"1"`, dynamic says `1.0009180758490996` (NVDAx).
  We ignore the list value.
- **xStocks prices look stale**: in the regular session, per-share TSLAx −1.72%, AAPLx −1.83%, MSFTx −1.28% vs the
  exchange price, while Ondo and bStocks sit within ±0.1%. A naive "cheapest issuer" router picks exactly these.
  The Guard now treats a discount beyond −1% as "out of date" (WARN) and ranks such offers last. The real test is
  the Trading API quote.
- Working well: all 8 curated tickers exist on BSC for all 3 issuers; responses are fast; no key, no rate-limit
  hit at 24 calls per 30 s.

### 2026-09-21 (day 2, evening): Trading + Transaction API, from the SDK source

Spec source: `binance/binance-web3-connector-js` (`@binance-web3/wallet` 12.3.0, OpenAPI-generated). Not yet run
live; entries below are from reading the types and will be confirmed or corrected after the first keyed call.

- Discoverability: searching for "Binance Web3 Trading API docs" finds the CEX docs. The connector repos were only
  found through another hackathon repo's README. The RWA skill doc and this SDK describe overlapping RWA endpoints
  on different hosts (`www.binance.com/bapi/...` public vs `web3.binance.com/build` keyed) and do not link to each other.
- `web3.binance.com` is reachable from Indonesian ISPs; `www.binance.com` is not. Moving the public RWA reads to the
  keyed host would remove our VPN dependency (to test).
- **Stock tokens never use the swap path.** "Equity / RWA tokens always return `RFQ`": quote → `/swap` returns EIP-712
  `typedDataToSign` → `POST /order/submit` → poll status. So PRD step 4 ("simulate via Transaction API") does not
  apply to stocks: there is no transaction to simulate, and the RFQ price is firm. Simulation stays for SWAP routes.
- `quoteAndBuildSwapTransaction` looks like the one-call path but its `vendor` is required and the enum has a single
  value, `LiquidMesh`. Best-route + RFQ needs the two-step `getAggregatedQuote` → `buildSwapTransaction(quoteId)`.
- Docs for `submitRfqOrder.quoteId` say "`rfq.orderId` from the `/swap` response", but the generated `rfq` type has
  no `orderId` field (`vendor`, `txType`, `typedDataToSign`, `signingScheme`, `signatureData`). To check live.
- `priceImpactPercent` is `(received − sent) / sent`, so a cost is negative. Easy to read backwards; we flip it.
- `simulateTransactions` marks `evmTx`, `solTx` and `tronTx` all required "for rendering purposes only"; the TS types
  force a cast to pass just one.
- Good: the SDK owns HMAC signing (`X-OC-APIKEY`/`X-OC-SIGN`), so no hand-rolled auth.

### 2026-09-21 (day 2, night): first keyed calls. What the SDK and docs got wrong

Live, read-only, $10 NVDA quote on BSC mainnet. Works end to end: Ondo executable at **+0.8 bps** vs the exchange,
bStocks **+4.55 bps**, both through LiquidMesh. Corrections to the entry above, all found the hard way:

- **SDK types lie about the envelope.** Every response type is `{ code, msg, data, success }`, but `.data()` returns
  the inner `data` (the SDK strips the envelope in `httpRequestFunction`). Code written against the types reads
  `body.success` → `undefined` → "request failed" on a perfectly good quote. Cost us one debugging round.
- **...and the stripped envelope hides every business error.** On HTTP 200 with an error `code`/`msg`, `.data()` is
  just `null`. "No route", "bad parameter" and "simulation failed" are indistinguishable. **Ask: throw on non-zero
  `code`, or expose the envelope.**
- **"Equity / RWA tokens always return RFQ" is false today.** NVDAon and NVDAB both return `executionMode: "SWAP"`
  via LiquidMesh with a normal `tx` + one approve. We handle both modes; RFQ remains untested because we never got one.
  Fun detail: the best NVDAon route goes USDT → **NVDAB** → NVDAon, through the other issuer's pool.
- **`simulateTransactions` is unusable for EVM in SDK 12.3.0**: it rejects the request unless `solTx` and `tronTx`
  are also supplied, while the API wants exactly one. With `{}` placeholders the call returns `null` and (see above)
  no reason. PRD step 4 is blocked on this; our wrapper throws rather than pretend. **Ask: make the three tx fields optional.**
- **xStocks: no route** (`null`) for $10 NVDAx, and xStocks is absent from the keyed API's issuer list (`ondo`,
  `bstock` only). That settles the earlier finding: the −1.7% xStocks "discount" is an unexecutable stale price.
  The public list still shows 128 xStocks tokens on BSC with no hint that they cannot be traded here.
- **Two RWA APIs, different answers.** Keyed `getRwaTokenList(56)`: 488 tokens (442 ondo, 46 bstock). Public list:
  458 + 77. The keyed one is better shaped (one call has status + `tokenToShareRatio`; prices are batched) and its
  host is not ISP-blocked in Indonesia.
- **Naming trap: `referencePrice` in `getRwaTokenPrice` is not the exchange price.** It equals `tokenPrice ÷
  tokenToShareRatio` exactly, i.e. the on-chain price per share. The exchange price is
  `getRwaUnderlyingMarketData.marketData.referencePrice` (same field name, different meaning), and that one is `null`
  for bStocks. Comparing the first against itself yields a permanent 0.00% spread: a Guard that always says GO.
- Three "exchange price" feeds sampled together differed by ~10 bps (223.36 / 223.63 / 223.74) in a moving market.
  Fine against a 50 bps threshold, but it bounds how tight any fair-price check can honestly be.
- Good: auth worked first try, quotes return in well under a second, `approveTransaction=true` hands back ready
  approve calldata, permissions are granular (we run with Trade/Transaction/Market/Wallet only).

## Issuer comparison (fill in during day 1-3)

| | bStocks | Ondo | xStocks |
| --- | --- | --- | --- |
| In Binance RWA Data API (`type`) | yes (3) | yes (1) | yes (2) |
| Tokens on BSC | 77 | 458 | 128 |
| Symbol suffix | `B` | `on` | `x` |
| Reports session (`marketStatus`) | no | yes | no |
| Reports exchange price | no | yes | yes |
| Price vs exchange, regular session | ±0.1% | ±0.1% | up to −1.8% (stale) |
| Executable via Trading API ($10 NVDA) | yes, +4.55 bps | yes, +0.8 bps | **no route** |
| In keyed RWA API | yes (`bstock`, 46) | yes (`ondo`, 442) | no |
| On BSC / liquidity | | | |
| Share accounting | multiplier | multiplier | multiplier (list value wrong, use dynamic) |
| Halt codes | | | |
| Session hours | | | |

## API friction (one row per incident)

| Date | API | What we tried | What happened | Suggested change |
| --- | --- | --- | --- | --- |
