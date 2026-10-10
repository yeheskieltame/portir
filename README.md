# Portir

Buy US stocks on BNB Chain as simply as a mutual fund, with a Guard that checks the market session and
the on-chain vs exchange price before every order.

## Layout

| Path | What | Status |
| --- | --- | --- |
| `packages/core` | `@portir/core`: the Guard (pure verdict logic), the Binance RWA Data client (catalog, quotes, fundamentals, K-lines, logos) and the Trading client (official SDK). | quote + build verified live on mainnet; `simulate` blocked by an SDK bug (see DevEx report) |
| `contracts` | Foundry + OpenZeppelin 5.7. `PlanRegistry`: DCA plans and run history, UUPS upgradeable. `LoanGuard`: keeps Venus borrowers out of liquidation, UUPS upgradeable. | tests green (5,000 fuzz runs), verified on BSC testnet and mainnet, testnet proxy upgraded in place (v2: `updatePlan`, `resumePlan`; v3: one-time "buy when fair" plans; v4: a completed once plan cannot be resumed; v5: plans pay from the owner through the registry, capped per run) |
| `apps/landing` | Static landing page (one HTML file, no build). Its own Vercel project on the root domain; the app lives on `app.<domain>`. | `pnpm dev:landing` → :3001 |
| `apps/portiragent` | The Portir agent on **BNB Agent Studio** (`bag` workspace, not part of the pnpm root workspace). One AgentCore runtime with three faces: **MCP** (`/mcp`, ten Portir tools for Claude or any client), **x402** (`/x402`, free passthrough answering with the same tools), **A2A**. Runs the **DCA executor**: scans `PlanRegistry` every 15 min, applies the Guard to single stocks and baskets (worst holding decides), buys on testnet with the owner's tUSDT pulled through PlanRegistry (capped at the plan amount per run) and sends the shares to the owner, records `Waited / Skipped / Executed` with a one-sentence reason; one-time "buy when fair" orders complete after their first buy. | live at `agent.portir.xyz` (Docker on a VPS); testnet executor and an armed mainnet executor through the Agentic Wallet |
| `apps/web` | Next.js app, mobile-first. Markets (510 US stocks/ETFs on BSC, search, filter, pages), stock detail (chart, Guard, providers, fundamentals), baskets, one-tap buy with the Guard, portfolio (live balances, history, dividends), plans, profile. | live; buying signs real BSC mainnet transactions |

**No backend.** The PRD's Postgres plan store is replaced by `PlanRegistry`: the app writes plans to it,
the Agent Studio executor reads due plans from it and logs each run (with its one-sentence reason) back.
The contract holds no funds. Two Next.js route handlers exist because `binance.com` is unreachable from
browsers here and the Trading API needs a server-side key: `/api/quote` (prices + history for the portfolio)
and `/api/buy` (Guard verdict + approval and swap calldata; the wallet signs, nothing is sent from the server).

**Live on BSC mainnet** (2026-10-11): `PlanRegistry` [`0x28da…f36b`](https://bscscan.com/address/0x28daDC35523CE792C7C09faf516763830C38f36b#code)
(verified; same address as on testnet). First user plan, end to end: 5 USDT pulled through the registry, swapped by the
Agentic Wallet to NVDAB ([swap](https://bscscan.com/tx/0xf4fa9429f705232799589fb02c9efa578384bcf8faf889ec060089132b934e9a)),
run recorded with its reason ([recordRun](https://bscscan.com/tx/0x269bb7b97eef7d22888bed8155850190bf5125eb08163117aef39de234fb0f90)),
shares delivered to the owner ([send](https://bscscan.com/tx/0x5138be3fc0abd72e69b2ddfbd03bb05f93afb794891a201273194e62b8a70116)).
Known limits: the registry owner is still the deployer, not a Safe; the Agentic Wallet only sends to addresses in its
in-app address book, so each plan owner is added by hand; orders under $5 are refused (see DEVEX_REPORT).

Not here yet, on purpose: the basket router contract (a basket buy is one guarded swap per holding,
signed in sequence), notifications. The MCP server is the agent's `/mcp` face rather than a separate npm package.

### The agent (`apps/portiragent`)

```sh
npm i -g @bnbagent/studio-cli && cd apps/portiragent
bag doctor                # wallet, Pieverse key, config
bag dev                   # A2A + MCP + /x402 on :9000, executor loop on
```

Env (in `.studio/.env.local`, set with `bag env set`): `PORTIR_REGISTRY` (PlanRegistry proxy), `PORTIR_REGISTRY_CHAIN`
(`testnet` default), `PORTIR_SCAN_SECONDS` (900), `PORTIR_EXECUTION` (`off` | `testnet` | `agentic-wallet`),
`PORTIR_MAINNET_ARMED=yes` (required, on top of `agentic-wallet`, before any mainnet spend), `PORTIR_BRAIN=claude-cli` (local dev:
the chat answers come from the operator's own Claude Code via `claude -p`, using this agent's MCP tools, instead of Pieverse), `PORTIR_TESTNET_KEEPER_KEY`
(signs TestExchange quotes; same key as the app's `TESTNET_KEEPER_KEY`), `BAW_SESSION_B64` (Agentic Wallet session), `BINANCE_W3_API_KEY/SECRET`
(executable quotes), `COINDESK_API_KEY` (optional news). The executor refuses a backend whose chain differs from the
registry's chain.

**Modes.** Profile → Mode switches the app between **testnet** (default: buys settle on BSC testnet with faucet tUSDT
against test stock tokens) and **mainnet** (real USDT and stock tokens). Prices, sessions, the Guard and news are live from
mainnet in both: testnet only changes where the trade settles, at a quote signed with the live mainnet price. The agent wallet (`bag wallet new`) is the plan **executor**: the app passes
it as `NEXT_PUBLIC_EXECUTOR`, and only it (or the owner) can `recordRun`. Connect Claude: `claude mcp add portir --transport
http https://agent.portir.xyz/mcp` (locally `http://localhost:9000/mcp`).

Trading runs on **BSC mainnet only** (stock tokens have no testnet). `PlanRegistry` has the same address on BSC testnet and
mainnet, so Plans follow the app's mode; the VPS runs one executor per chain (`agent` and `agent-mainnet` in
`apps/portiragent/deploy/compose.yaml`). Put `BINANCE_W3_API_KEY` / `BINANCE_W3_API_SECRET` in
`apps/web/.env.local`; `pnpm --filter @portir/core smoke:trade` checks the Trading API read-only.

`www.binance.com` is DNS-blocked on Indonesian ISPs. Locally the catalog falls back to labelled sample prices unless you
are on a VPN; `pnpm --filter @portir/core smoke` checks the live API.

**What the agent automates.** Plans (recurring or "buy once when fair", stocks or baskets) funded from the owner's wallet
through `PlanRegistry`; **sell rules** (take-profit / stop-loss, PlanRegistry v6: the agent pulls exactly the rule's shares
once the live price crosses the trigger in market hours, sells, and sends the proceeds to the owner); a **news check**
before every buy (the LLM reads the last 72h of headlines and may only hold the buy back, with its reason recorded
on-chain; fail-open when no model answers); **Loan Guard** (below); and **Telegram reports** of every recorded outcome
and rescue (`TELEGRAM_BOT_TOKEN`; users link from Profile via `t.me/<bot>?start=<address>`).

**Brains.** Production chat and the news check run on Groq (`openai/gpt-oss-120b`) through Agent Studio's OpenAI-compatible
provider (`studio.toml` [llm], key `GROQ_API_KEY`); Pieverse stays configured as the alternative. `PORTIR_BRAIN=claude-cli` is for local development.
Users can instead bring their own Claude over MCP (`https://agent.portir.xyz/mcp`), and run a fully self-custodial agent:
Cowork's scheduler + Portir MCP + their own Binance Agentic Wallet skill (Profile → Run your own agent).

**Hosting.** The agent runs in Docker on a VPS behind Caddy at `https://agent.portir.xyz` (fixed IP for the B402
allowlist); see `apps/portiragent/deploy/`. One agent process per wallet.

### Loan Guard (stock-backed loans)

Borrow against your tokenized stocks without waking up liquidated. The borrower sets a guard on `LoanGuard` (trigger
and target as a share of the liquidation limit, a cap per rescue, a cooldown) and approves it for a safety buffer in the
debt token. Every `PORTIR_GUARD_SECONDS` (300) the agent reads each guarded position; past the trigger it repays just
enough to reach the target, capped. The contract re-checks the position on-chain from the pool's own oracle and
liquidation thresholds (`usedBps = debt / Σ collateral × LT`) before anything moves, then repays with
`repayBorrowBehalf` straight from the borrower. Nothing passes through the agent; a leaked agent key can only repay the
borrower's own debt, capped.

**Mainnet:** Venus accepts four tokenized stocks as collateral, all bStocks tokens (checked on-chain 2026-09-28): vNVDAB and
vTSLAB (collateral factor 60%, liquidation at 70%), vSPCXB and vSKHYB (50% / 65%). Loans offer exactly these; LoanGuard speaks the
Venus comptroller/vToken interface, so the same contract points at the Venus core pool. **Testnet:** Venus has no stock
markets, so `StockLendingPool` stands in with the same interface and parameters over the same four MockStocks (NVDA, TSLA, SPCX, SKHY, with Venus' limits) as collateral
and tUSDT (debt), with real liquidations; the agent mirrors live stock prices into it every scan
([`0x7E83…64c2`](https://testnet.bscscan.com/address/0x7E8317704d8a0F7EA9f3E46b706FBa3e162f64c2#code), LoanGuard
[`0xa33f…3f61`](https://testnet.bscscan.com/address/0xa33fDbd747d95bD733172D9D7c4d6c50CcE33f61#code), addresses in
`contracts/deployments/stockpool-testnet.json`). Verified live: 2.22 NVDA bought through Portir, supplied, borrowed to
85.7% of the liquidation limit; the agent repaid 89.71 tUSDT from the buffer to exactly the 60% target. App: `/loans`
(one batch: buy → supply → borrow → guard). MCP: `get_loan_health`. An earlier deployment against the Venus core pool on
testnet (CAKE collateral) is kept in `deployments/venus-testnet.json`. Idea credit: the Fortion project's guard policy
(a dry run there; the on-chain authorization is new here).

## Backlog (decided, not started)

- Mainnet sell rules (buys run on mainnet; sell rules are testnet-only).
- Move catalog reads from the public `www.binance.com` RWA API to the keyed one on `web3.binance.com`: not ISP-blocked,
  fewer calls, and its issuer list is the source of truth for what can be traded. Take the exchange price from
  `getRwaUnderlyingMarketData`, never from `getRwaTokenPrice.referencePrice` (see DEVEX_REPORT).
- `simulate` (PRD Guard step 4): call the REST endpoint with our own request signing; until then the swap's `minTokensOut` (0.5%) is the guard.
- Transfer mainnet `PlanRegistry` ownership to a Safe (`Ownable2Step`).
- Cost basis lives in `localStorage` (purchases made in the app on that device) until there is an indexer.

## Deployments

- Landing: https://portir.xyz · App: https://app.portir.xyz (Vercel, root directories `apps/landing`
  and `apps/web`; env vars from `apps/web/.env.example` set in the project).
- On Vercel the catalog, charts and portfolio are live. **Buying is quoted only from a non-cloud network**: the Binance
  Trading API answers `40304 compliance restriction` to every cloud region we tried, so `/api/buy` is demoed from a local
  run (`pnpm dev`, works from Indonesia). Details in `DEVEX_REPORT.md`.

| Network | PlanRegistry (proxy) | Implementation | Verified |
| --- | --- | --- | --- |
| BSC testnet (97) | `0x28daDC35523CE792C7C09faf516763830C38f36b` | `0x3913373DD9aB1318cA77cf133894042139b8Af44` (v5; v4 `0xe01E…2379`, v3 `0x07E0…b6D9`, v2 `0xEb62…d172`, v1 `0xD408…315C`) | [BscScan](https://testnet.bscscan.com/address/0x28daDC35523CE792C7C09faf516763830C38f36b#code) (proxy linked) + Sourcify |

Testnet fixtures (`contracts/src/testnet/`, non-upgradeable test doubles, all verified; addresses in
`contracts/deployments/testnet.json`): `MockUSDT`, freely mintable (10,000 per faucet claim, `mint(to, amount)` up to 1M, no cooldown)
([`0xA240…2aA2`](https://testnet.bscscan.com/address/0xA2408d502b0Cd09FA5fBAdFC3A6F6CB3F49D2aA2#code)), `TestExchange`
that sells and buys back shares at an EIP-712 quote signed by the keeper key, one holding or a whole basket per transaction (`buyBatch`)
([`0xF191…6Bad8`](https://testnet.bscscan.com/address/0xF191283aEa66De969a2D26BB0aF52629D3c6Bad8#code)), and one `MockStock`
for every featured and basket ticker (18). `/api/buy` (and the agent) sign the live mainnet price into each quote, valid 10
minutes, so nothing on testnet can go stale and the Guard sees exactly what mainnet would. `pnpm deploy:testnet:usdt` (once; `REPLACE=1` swaps it, which needs a new exchange too) / `KEEPER=<signer> pnpm
deploy:testnet:exchange` (exchange + stocks, reuses tUSDT) / `pnpm add:testnet:stocks` (idempotent, add tickers to the list in `AddStocks.s.sol`) /
`pnpm verify:testnet:fixtures`. Security review of `PlanRegistry`: `contracts/AUDIT.md`.

## Run

```sh
git submodule update --init --recursive   # forge-std, OpenZeppelin
pnpm install
pnpm test                     # core + contracts
pnpm dev                      # http://localhost:3000
```

`apps/web/.env.example` lists every variable. CI (`.github/workflows/ci.yml`) runs `forge fmt --check`, `forge test`,
core tests, web lint and a production build.

Plans page against a local chain:

```sh
anvil
forge script script/Deploy.s.sol --root contracts --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key <anvil key #0, printed when anvil starts>
# apps/web/.env.local
NEXT_PUBLIC_CHAIN=anvil
NEXT_PUBLIC_PLAN_REGISTRY=<printed proxy address>
```

Testnet/mainnet deploy uses the encrypted keystore `portir-deployer` (`~/.foundry/keystores/`), unlocked by the
gitignored `contracts/.keystore-password`. Fund the address (`cast wallet address --account portir-deployer
--password-file contracts/.keystore-password`), then `pnpm deploy:testnet` (or `deploy:mainnet`). Put the printed
proxy address in `apps/web/.env.local` with `NEXT_PUBLIC_CHAIN=testnet`.
`OWNER=<addr>` sets the upgrade admin (default: the deployer); use a multisig for anything real.

Upgrades: edit `PlanRegistry.sol` (only append fields to `PlanRegistryStorage`, never reorder), then
`PROXY=<proxy> pnpm upgrade:testnet` (`script/Upgrade.s.sol`, owner keystore) and `pnpm verify:testnet`. The contract keeps
its name, so the OZ plugin cannot diff the layout against a reference build; the script skips that one check and the
layout rule is enforced by review (`contracts/AUDIT.md`). Everything else the plugin validates still runs.
