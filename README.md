# Portir

Buy US stocks on BNB Chain as simply as a mutual fund, with a Guard that checks the market session and
the on-chain vs exchange price before every order.

## Layout

| Path | What | Status |
| --- | --- | --- |
| `packages/core` | `@portir/core`: the Guard (pure verdict logic), the Binance RWA Data client (catalog, quotes, fundamentals, K-lines, logos) and the Trading client (official SDK). | quote + build verified live on mainnet; `simulate` blocked by an SDK bug (see DevEx report) |
| `contracts` | Foundry + OpenZeppelin 5.7. `PlanRegistry`: DCA plans and run history, UUPS upgradeable. | 15 tests, verified on BSC testnet, upgraded in place twice (v2: `updatePlan`, `resumePlan`; v3: one-time "buy when fair" plans) |
| `apps/landing` | Static landing page (one HTML file, no build). Its own Vercel project on the root domain; the app lives on `app.<domain>`. | `pnpm dev:landing` → :3001 |
| `apps/portiragent` | The Portir agent on **BNB Agent Studio** (`bag` workspace, not part of the pnpm root workspace). One AgentCore runtime with three faces: **MCP** (`/mcp`, ten Portir tools for Claude or any client), **x402** (`/x402`, free passthrough answering with the same tools), **A2A**. Runs the **DCA executor**: scans `PlanRegistry` every 15 min, applies the Guard to single stocks and baskets (worst holding decides), buys on testnet, records `Waited / Skipped / Executed` with a one-sentence reason; one-time "buy when fair" orders complete after their first buy. | runs locally (`cd apps/portiragent && bag dev`); trial deploy next; execution backend off until the Agentic Wallet test |
| `apps/web` | Next.js app, mobile-first. Markets (510 US stocks/ETFs on BSC, search, filter, pages), stock detail (chart, Guard, providers, fundamentals), baskets, one-tap buy with the Guard, portfolio (live balances, history, dividends), plans, profile. | live; buying signs real BSC mainnet transactions |

**No backend.** The PRD's Postgres plan store is replaced by `PlanRegistry`: the app writes plans to it,
the Agent Studio executor reads due plans from it and logs each run (with its one-sentence reason) back.
The contract holds no funds. Two Next.js route handlers exist because `binance.com` is unreachable from
browsers here and the Trading API needs a server-side key: `/api/quote` (prices + history for the portfolio)
and `/api/buy` (Guard verdict + approval and swap calldata; the wallet signs, nothing is sent from the server).

Not here yet, on purpose: mainnet execution through the Agentic Wallet session (the backend exists but stays armed off
until the checklist in `contracts/AUDIT.md`), the basket router contract (a basket buy is one guarded swap per holding,
signed in sequence), notifications. The MCP server is the agent's `/mcp` face rather than a separate npm package.

### The agent (`apps/portiragent`)

```sh
npm i -g @bnbagent/studio-cli && cd apps/portiragent
bag doctor                # wallet, Pieverse key, config
bag dev                   # A2A + MCP + /x402 on :9000, executor loop on
```

Env (in `.studio/.env.local`, set with `bag env set`): `PORTIR_REGISTRY` (PlanRegistry proxy), `PORTIR_REGISTRY_CHAIN`
(`testnet` default), `PORTIR_SCAN_SECONDS` (900), `PORTIR_EXECUTION` (`off` | `testnet` | `agentic-wallet`),
`PORTIR_MAINNET_ARMED=yes` (required, on top of `agentic-wallet`, before any mainnet spend), `PORTIR_TESTNET_KEEPER_KEY`
(signs TestExchange quotes; same key as the app's `TESTNET_KEEPER_KEY`), `BAW_SESSION_B64` (Agentic Wallet session), `BINANCE_W3_API_KEY/SECRET`
(executable quotes), `COINDESK_API_KEY` (optional news). The executor refuses a backend whose chain differs from the
registry's chain.

**Modes.** Profile → Mode switches the app between **testnet** (default: buys settle on BSC testnet with faucet tUSDT
against test stock tokens) and **mainnet** (real USDT and stock tokens). Prices, sessions, the Guard and news are live from
mainnet in both: testnet only changes where the trade settles, at a quote signed with the live mainnet price. The agent wallet (`bag wallet new`) is the plan **executor**: the app passes
it as `NEXT_PUBLIC_EXECUTOR`, and only it (or the owner) can `recordRun`. Connect Claude: `claude mcp add portir --transport
http http://localhost:9000/mcp`.

Trading runs on **BSC mainnet only** (stock tokens have no testnet). `PlanRegistry` stays on testnet until the app is done,
so the wallet is asked to switch network between Plans and Buy. Put `BINANCE_W3_API_KEY` / `BINANCE_W3_API_SECRET` in
`apps/web/.env.local`; `pnpm --filter @portir/core smoke:trade` checks the Trading API read-only.

`www.binance.com` is DNS-blocked on Indonesian ISPs. Locally the catalog falls back to labelled sample prices unless you
are on a VPN; `pnpm --filter @portir/core smoke` checks the live API.

## Backlog (decided, not started)

- Executor agent on BNB Agent Studio signing through an Agentic Wallet session; then `NEXT_PUBLIC_EXECUTOR`.
- `@portir/mcp`: the same engine as MCP tools (`search_stock`, `get_fair_price`, `market_window`, `quote_best_issuer`, `create_dca_plan`, `execute_buy`, `get_portfolio`).
- Move catalog reads from the public `www.binance.com` RWA API to the keyed one on `web3.binance.com`: not ISP-blocked,
  fewer calls, and its issuer list is the source of truth for what can be traded. Take the exchange price from
  `getRwaUnderlyingMarketData`, never from `getRwaTokenPrice.referencePrice` (see DEVEX_REPORT).
- `simulate` (PRD Guard step 4): call the REST endpoint with our own request signing; until then the swap's `minTokensOut` (0.5%) is the guard.
- `PlanRegistry` on mainnet with a multisig `OWNER`.
- Cost basis lives in `localStorage` (purchases made in the app on that device) until there is an indexer.

## Deployments

- Landing: https://portir.xyz · App: https://app.portir.xyz (Vercel, root directories `apps/landing`
  and `apps/web`; env vars from `apps/web/.env.example` set in the project).
- On Vercel the catalog, charts and portfolio are live. **Buying is quoted only from a non-cloud network**: the Binance
  Trading API answers `40304 compliance restriction` to every cloud region we tried, so `/api/buy` is demoed from a local
  run (`pnpm dev`, works from Indonesia). Details in `DEVEX_REPORT.md`.

| Network | PlanRegistry (proxy) | Implementation | Verified |
| --- | --- | --- | --- |
| BSC testnet (97) | `0x28daDC35523CE792C7C09faf516763830C38f36b` | `0x07E084554719BDECbdDEC0EabaD592cD40A7b6D9` (v3; v2 `0xEb62…d172`, v1 `0xD408…315C`) | [BscScan](https://testnet.bscscan.com/address/0x28daDC35523CE792C7C09faf516763830C38f36b#code) (proxy linked) + Sourcify |

Testnet fixtures (`contracts/src/testnet/`, non-upgradeable test doubles, all verified; addresses in
`contracts/deployments/testnet.json`): `MockUSDT` with a 1,000/day faucet
([`0xa3Ce…73e3`](https://testnet.bscscan.com/address/0xa3CeC722a4FBDD4901Ab6d19281A2646786773e3#code)), `TestExchange`
that sells and buys back shares at an EIP-712 quote signed by the keeper key
([`0x9cc2…37DF`](https://testnet.bscscan.com/address/0x9cc2e2A087084243D909C6b4Cc681C0734bc37DF#code)), and one `MockStock`
for every featured and basket ticker (18). `/api/buy` (and the agent) sign the live mainnet price into each quote, valid 10
minutes, so nothing on testnet can go stale and the Guard sees exactly what mainnet would. `KEEPER=<signer> pnpm
deploy:testnet:fixtures` / `pnpm add:testnet:stocks` (idempotent, add tickers to the list in `AddStocks.s.sol`) /
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
