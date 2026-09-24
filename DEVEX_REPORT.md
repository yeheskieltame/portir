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

### 2026-09-22 (day 3): landing, app shell, full catalog, charts

- **The stock list has no names and no logos.** `stock/detail/list` gives ticker + symbol + contract only. Names come from
  `rwa/meta` (`name` = "NVIDIA (Ondo Tokenized)": strip the bracket) and logos from `meta.icon` (relative path, prepend
  `https://bin.bnbstatic.com`). One extra request per token just to render a row. **Ask: `name` and `icon` in the list.**
- **The logo CDN answers 403 when a `Referer` header is present.** Hotlinks from a web page break silently; `<img
  referrerPolicy="no-referrer">` fixes it. Undocumented.
- **`assetType` is undocumented but useful**: `1` = stock, `3` = ETF (QQQ, SPY, IVV, AGG...), `null` for a few, one `4`.
  We use it for the Stocks/ETFs filter. **Ask: document it.**
- **Scale**: 663 tokens, **510 distinct tickers**, 116 with more than one issuer. Pricing all of them is one `dynamic`
  request each, so the app prices only the page it shows (10 rows) and caches the list for a minute.
- **K-lines (`dex/market/token/kline`) are per token, not per share**: divide by the current `sharesMultiplier` to draw a
  share price chart. `limit` caps at 300, so "1Y" is 300 daily candles.
- **`stockInfo.priceHigh52w` / `priceLow52w` / `priceToEarnings` / `dividendYield` / `marketCap`** are populated for Ondo
  tokens; bStocks returns them too but its `stockInfo.price` stays `null`. `totalHolders` is per token, so a stock's
  holder count is the sum across issuers.
- **Dividends are the multiplier.** No dividend endpoint exists, but `sharesMultiplier` above 1 is exactly the reinvested
  dividend share: `shares × (1 − 1/multiplier)`. That is enough for a "dividends reinvested so far" section without history.
  A historical multiplier series would let us show dividend events; the K-line does not carry it.

### 2026-09-23 (day 4): the buy flow, end to end (calldata verified, mainnet signing pending)

- **Approval payload format** (`signatureData[]` on `buildSwapTransaction`): JSON strings
  `{"approveContract": <spender>, "approveTxCalldata": <approve(spender, amount) calldata>}`. The calldata is sent **to the
  USDT contract**, not to `approveContract`; the docs do not say which. The API includes the approval every time
  (`approveTransaction=true`), even when the allowance already covers the order, so the client checks `allowance()` first
  or the user signs two transactions per purchase forever. **Ask: omit the approval when the allowance is sufficient, or
  return the required amount so clients can decide.**
- **Every stock route we saw is SWAP through LiquidMesh** (Ondo and bStocks, several tickers, $10–$100). We never
  received an RFQ, so the EIP-712 path stays untested; the app declines RFQ routes explicitly rather than guessing.
- `minReceiveAmount` from the build call is the only fill guarantee we have while `simulateTransactions` is blocked;
  0.5% slippage on a 0.01% spread is loose but honest. Documented in the UI as "At least N shares".
- **Two networks in one wallet session.** Stock tokens exist only on mainnet, `PlanRegistry` is on testnet, so a user who
  sets a plan and then buys is asked to switch chains twice. Fine for a hackathon week; the fix is a mainnet registry.
- **Mobile browsers without an injected wallet** can do nothing: `injected()` connects only inside Binance Wallet or
  MetaMask's browser or a desktop extension. The app now says so instead of failing silently. Binance Wallet SDK /
  Agentic Wallet integration is the real answer (next).
- Tooling: `@portir/core` uses `bigint` literals, and Next's default `tsconfig` targets ES2017, which rejects them under
  `tsc` while the bundler is fine; `target: ES2020` fixes the mismatch.

### 2026-09-23 (day 4, night): deployed to Vercel. The Trading API refuses every cloud region

Landing and app are live (`portir-landing.vercel.app`, `portir-app.vercel.app`); the RWA Data API works from Vercel
without a VPN, so the catalog, charts and portfolio are live for anyone. The Trading API is not:

- **`/api/buy` returned "no route" from Vercel while the same key and order worked from a laptop in Indonesia.** The
  SDK hides the reason (see day 2), so we re-implemented its signing (`rawGet` in core: prehash = ISO timestamp + method +
  `/build` + path + query + body, HMAC-SHA256, base64; note the request goes to `/build/api/v1/...` and the signed path
  includes `/build`) to read the envelope: **`code 40304, "Service not available due to compliance restriction"`**.
- Same answer from six Vercel regions: Washington (iad1), Singapore (sin1), Hong Kong (hkg1), Dubai (dxb1), São Paulo
  (gru1), Frankfurt (fra1). Brazil, France and the UAE are markets where Binance is licensed, so this is not a country
  rule: cloud / datacenter IP ranges are refused as a class. Authentication passes (a wrong key or secret gives distinct
  errors), and the same request from a residential IP succeeds.
- Consequence for any "agent" product on this API: a server-side signer cannot live on Vercel, AWS, or similar. Options
  are a residential egress, or Binance whitelisting the key's IPs. **Ask: document the restriction, and let a developer
  key allowlist its server IPs in the portal.** Until then the buy flow is demoed from a local run; the deployed app
  shows the real reason instead of a generic failure.

### 2026-09-23 (day 5): BNB Agent Studio, from `bag init` to a signed `recordRun`

- **Onboarding**: `npm i -g @bnbagent/studio-cli` → `bag init portiragent --protocols A2A,MCP,X402 --wallet-kind evm-local
  --network bsc-testnet --seller-price-usd 0 --no-onboard` → `bag wallet new --generate-password` → `bag llm activate`
  (zero-deposit Pieverse key) → `bag doctor` all green. About 20 minutes including reading the skill. Good: the CLI also
  installs a Claude Code skill with playbooks; `bag doctor` explains every warning with the exact faucet command.
- **Model of the product vs ours.** Studio scaffolds a *seller* (ERC-8183 negotiate/notify_funded + a B402-priced
  `/x402`). Portir needs a *worker* that acts on a schedule. There is no cron primitive, but the runtime is one
  long-running process, so a `setInterval` in the entrypoint works (`startDcaLoop()` after `app.listen`). **Ask: document
  "background loops are fine in dualMain" — the docs only describe request-driven faces.**
- **Signing boundary is well designed**: `getWallet().signTransaction()` takes a legacy tx + `chainId`, returns the raw tx,
  and we broadcast with viem. `wallet.address` is a getter, not a method (the SDK docs read like a method).
- **Bundling**: `bag deploy` bundles with esbuild, so linking our TypeScript-source package (`@portir/core`) works with
  `rewriteRelativeImportExtensions: true` in the agent's tsconfig (core imports `./x.ts`). Local `bag dev` uses tsx.
- **MCP face composes**: `buildMcpServer` is user-owned, so ten Portir tools registered next to the seller tools show
  up in `tools/list` immediately; the same definitions wrap into AI SDK tools for the LLM behind `/x402`.
- **First real run**: plan 0 (NVDA, 10 USDT weekly, smart timing, executor = agent wallet) → the agent recorded
  `Waited: "The market is in after-hours and the price is fair; waiting for the open."` on BSC testnet
  (`0x2e48f7…1a71c`), signed by the agent. The app's plan history shows it.
- **Free model quality**: Pieverse `auto/free` answered the x402 question correctly using `get_fair_price` and
  `market_window`, but leaked its `</think>` scratchpad into the answer. A paid model or output stripping is needed for
  anything user-facing.
- Not yet: the 48h trial deploy needs `bag platform login` (GitHub device flow, interactive) and whether the Trading API
  accepts the trial's IPs is the open question from day 4.

### 2026-09-23 (day 5, later): Agentic Wallet as the executor's hands

- **Install**: `npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet` asks which of 79
  agents to install to and defaults to a dozen; the CLI itself is `npx @binance/agentic-wallet` (1.10.0), not on PATH
  as `baw`. The skill references are excellent (one file per command, every response documented).
- **Sign-in is a race.** `auth signin --json` → open `urlForWeb` → scan in the Binance App → `auth verify` blocks. The QR
  died on us twice ("QR code does not exist or expired") within well under the documented 5 minutes; third try worked
  when the app was already open on the scan screen. **Ask: longer QR TTL, or a resumable verify.**
- **Headless works.** The session is one 112-byte file, `~/.baw/session.json` (0600); the CLI honours `BINANCE_BAW_DIR`
  (undocumented; found by grepping `process.env`), so a deployed agent can materialise it from a secret into a writable
  dir. Limits: `maxSigninDuration 48h`, `inactiveSignoutDuration 48h`, `signInMaxTime` seven days → an executor must be
  re-paired weekly by a human. Fine for a demo; an "agent session" that outlives a week is the real ask.
- **Limits live in the app, read-only from the CLI**: daily limit (default 50,000), token scope, abnormal-tx handling
  `AutoReject`, x402 daily limit 20, dev mode off. Exactly the scoped-session guardrail the PRD wanted, without any code.
- **Quotes agree.** `market-order quote 10 USDT → NVDAon` returned 0.043493 shares; our Trading API route quoted 0.043826
  seconds earlier (same Ondo pool, 0.5% default slippage on the wallet side). The wallet also runs the swap from Binance's
  side, so this path is not affected by the cloud-IP `40304` block — the executor now buys through it
  (`PORTIR_EXECUTION=agentic-wallet`), re-running the Guard on the wallet's executable price first.
- **`baw` stores raw JSON badly through env channels**: `bag env set KEY '{"…"}'` kept one character. Base64 it.
- Untested until funds land: a real `market-order swap` + `market-order list` poll to `FINISHED`.
- **Which stablecoin?** The Trading API refuses USDC for Ondo tokens: `40368 "Ondo asset on chain 56 can only pair with
  allowed stablecoin(s); got: 0x8ac7…d580d"` — the allowed list is not published anywhere we found (USDT works). The
  Agentic Wallet quotes the same USDC → NVDAon at 0.043534 shares (it routes through USDT itself). So USDT is the
  settlement asset in the app, and the wallet path is the only way to spend USDC. **Ask: expose the allowed stablecoin list
  per issuer in the RWA meta, and return it in the 40368 message.**

### 2026-09-23 (day 5, night): testnet mode end to end, and a near-miss

- **Why a testnet mode.** Stock tokens exist only on mainnet, so "try before you spend" needs fixtures: `MockUSDT`
  (faucet), `MockStock` per featured ticker, and a `TestExchange` whose keeper mirrors the mainnet on-chain price. The
  Guard, sessions and news stay live from mainnet; only settlement moves to BSC testnet. The app switches with a cookie
  (Profile → Mode), the executor with `PORTIR_EXECUTION=testnet`. Whole loop verified: keeper push → app quote (GO, −84
  bps, calldata to the exchange) → executor faucet/approve/buy → `Executed` recorded with the tx.
- **Near-miss, our side.** `bag env set PORTIR_EXECUTION testnet` printed `export PORTIR_EXECUTION=testnet` but did
  **not** change the file (the key already existed; earlier sets of new keys worked). The next scan therefore ran the
  Agentic Wallet backend — a real mainnet `market-order swap` for plan 1 — which Binance refused for lack of USDT. No money
  moved. Two fixes landed the same hour: the executor now refuses any backend whose chain differs from the registry's
  chain, and mainnet additionally requires `PORTIR_MAINNET_ARMED=yes`. **Ask (Studio): make `bag env set` fail loudly
  when it cannot persist, and print the value it read back.**
- Agentic Wallet's refusal message was clear and cheap ("USDT balance is insufficient"), and the wallet's own limits would
  have capped a real order. Defence in depth worked; it should not have been needed.
- **Dropped the keeper loop the next day.** A pushed price is only as fresh as the last cron tick: the first real click
  after a quiet hour hit "testnet price has not been refreshed", a failure mode that exists only on testnet and would teach
  the agent the wrong lesson. `TestExchange` v2 takes an EIP-712 quote `(stock, price, deadline)` signed by a keeper key
  instead; `/api/buy` and the executor sign the live mainnet price into every order (10-minute deadline). Testnet is now
  purely a settlement venue: same data, same Guard, same reasons as mainnet. Redeployed all 20 fixtures (~0.0015 tBNB).

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
| 09-21 | RWA Data (public) | Fetch from a browser in Indonesia | `www.binance.com` DNS-blocked by ISPs | Serve RWA data from a non-blocked host (the keyed `web3.binance.com` API already is) |
| 09-21 | RWA Data `stock/detail/list` | Use `multiplier` from the list | Wrong (1) for xStocks; `dynamic.sharesMultiplier` is right | Drop or fix the list field |
| 09-21 | RWA Data `dynamic` | Compare on-chain vs exchange for bStocks | `stockInfo.price` always `null` | Populate the exchange price for every issuer |
| 09-21 | Trading SDK 12.3.0 | Read `.data().success` | SDK strips the envelope; errors become `null` | Throw on non-zero `code` or expose the envelope |
| 09-21 | Trading SDK `simulateTransactions` | EVM-only dry run | Rejected unless `solTx`/`tronTx` present; then `null` | Make the three tx fields optional |
| 09-21 | RWA keyed `getRwaTokenPrice` | Use `referencePrice` as exchange price | It is the on-chain per-share price | Rename, or document that `getRwaUnderlyingMarketData` holds the exchange price |
| 09-22 | RWA Data `stock/detail/list` | Render names and logos | Neither is in the list; `meta` per token | Add `name` and `icon` to the list |
| 09-22 | `bin.bnbstatic.com` logos | `<img src>` from a page | 403 when a Referer is sent | Allow hotlinking or document `no-referrer` |
| 09-22 | RWA Data `stock/detail/list` | Tell stocks from ETFs | `assetType` works (1 / 3) but is undocumented | Document it |
| 09-23 | Trading `buildSwapTransaction` | Send the approval | `signatureData` is JSON strings; calldata goes to the token contract; always included | Document the format; omit when allowance suffices |
| 09-23 | Trading `aggregator/quote` | Call from Vercel (6 regions) | `40304 compliance restriction` for every cloud IP; fine from a home IP | Document it; allow per-key server IP allowlists |
| 09-23 | Trading `aggregator/quote` | Buy NVDAon with USDC | `40368` "can only pair with allowed stablecoin(s)"; list unpublished | Publish the allowed stables per issuer; include them in the error |
| 09-23 | Agentic Wallet `auth signin` | Scan QR from the app | Code expired twice in well under 5 min | Longer TTL or resumable verify |

### 2026-09-24 (day 6): the agent inside the app, and `updatePlan` by upgrade

- **"Ask the agent" in the app.** The Plans page now talks to the agent's free `/x402` face through one Next route
  (`/api/agent`); the same LLM + Portir tools that serve MCP answer "is now a good time to buy TSLA?" and turn "invest $50
  in AI & Semis every Monday, only when fair" into a plan the user signs. Structured output over x402 is text-only, so the
  agent ends a plan suggestion with a single `PLAN {...}` line the app parses and validates (tickers, basket names,
  cadence) before it shows a confirm button. Works, with one DevEx note below.
- **Pieverse free model rate limit.** A handful of requests in a row returned `AI_APICallError: Too Many Requests`
  after the SDK's three retries (the runtime logs `[x402] free work failed`, the caller gets `{"error":"work failed"}`,
  HTTP 500). Nothing in the response says *why*. **Ask: surface the provider status (429, retry-after) in the x402
  error body, and document the free model's limits** so a demo can pace itself or budget a paid model.
- **Node `localhost` → `::1`.** The app's server-side fetch to `localhost:9000` failed while `curl` succeeded: the runtime
  binds `127.0.0.1` and Node resolved `localhost` to IPv6. `PORTIR_AGENT_URL` defaults to `http://127.0.0.1:9000` now.
  Ask (Studio): bind both, or print the exact URL to use from other processes.
- **PlanRegistry v2 in place.** `updatePlan` and `resumePlan` (pause/resume, edit amount, cadence, smart timing) shipped
  as a UUPS upgrade of the testnet proxy (`script/Upgrade.s.sol`, `pnpm upgrade:testnet`), storage untouched; details in
  `contracts/AUDIT.md`. `fs_permissions` needed `./out` read access for the OZ plugin's validation (not documented).
