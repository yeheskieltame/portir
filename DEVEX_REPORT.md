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
  Consequence today: the client is tested against the documented samples only, not yet against live responses.
- The RWA API covers **Ondo only** (`type=1`). bStocks/xStocks are not in it, so issuer routing (PRD F2 step 3) has
  no data source here; to confirm against the Trading API.
- PRD assumed Ondo rebases. It does not: Ondo uses a `multiplier` (shares per token), growing with reinvested
  dividends, 5.0/10.0 after splits. Per-share price = `tokenInfo.price / sharesMultiplier`.
- `stockInfo.price` is `null` outside trading hours, exactly when the fair-price check matters most. We show
  "exchange price unavailable" rather than invent a reference. Needed: last close + timestamp in that field.
- `tokenInfo.volume24h` is the US stock's USD volume, not on-chain volume (documented, but the name misleads).
- `dynamic` returns `statusInfo` with every field `null` in the sample, so status needs a second call per token.
- `market/status.openState` means "Ondo is tradable" (includes overnight), not "NYSE is open". Session comes only
  from `asset/market/status.marketStatus`.

## Issuer comparison (fill in during day 1-3)

| | bStocks | Ondo | xStocks |
| --- | --- | --- | --- |
| In Binance RWA Data API | no | yes (`type=1`) | no |
| On BSC / liquidity | | | |
| Share accounting (multiplier vs rebase) | | multiplier | |
| Halt codes | | | |
| Session hours | | | |

## API friction (one row per incident)

| Date | API | What we tried | What happened | Suggested change |
| --- | --- | --- | --- | --- |
