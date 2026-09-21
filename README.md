# Portir

Buy US stocks on BNB Chain as simply as a mutual fund, with a Guard that checks the market session and
the on-chain vs exchange price before every order.

## Layout

| Path | What | Status |
| --- | --- | --- |
| `packages/core` | `@portir/core`: the Guard (pure verdict logic) and the Binance RWA Data client. | RWA Data client and Trading client (official SDK): quote + build verified live on mainnet; simulate blocked by an SDK bug |
| `contracts` | Foundry + OpenZeppelin 5.7. `PlanRegistry`: DCA plans and run history, UUPS upgradeable. | tested, on BSC testnet |
| `apps/web` | Next.js app: stock catalog, recurring plans. | catalog reads live prices server-side, labelled sample fallback; plans live against the contract |

**No backend.** The PRD's Postgres plan store is replaced by `PlanRegistry`: the app writes plans to it,
the Agent Studio executor reads due plans from it and logs each run (with its one-sentence reason) back.
The contract holds no funds; swaps are signed by the user's Agentic Wallet session.

Not here yet, on purpose: `@portir/mcp` (PRD day 17), the basket router contract (PRD §12 Q3, decide in
week 2), signing and submitting orders from the app.

Trading runs on **BSC mainnet only** (stock tokens have no testnet); quoting is read-only. `PlanRegistry` stays on testnet
until the app is done. Put `BINANCE_W3_API_KEY` / `BINANCE_W3_API_SECRET` in `apps/web/.env.local`, then
`pnpm --filter @portir/core smoke:trade`.

`www.binance.com` is DNS-blocked on Indonesian ISPs. Locally the catalog falls back to sample prices unless you are
on a VPN; `pnpm --filter @portir/core smoke` checks the live API. Deployed (Vercel) it reads live data.

## Backlog (decided, not started)

- Move catalog reads from the public `www.binance.com` RWA API to the keyed one on `web3.binance.com`: not ISP-blocked
  in Indonesia (no VPN for local dev), ~10 calls instead of 24, and its issuer list (`ondo`, `bstock`) is the source of
  truth for what can be traded, so xStocks drops out. Trade-off: the catalog then needs the API key. Take the exchange
  price from `getRwaUnderlyingMarketData`, never from `getRwaTokenPrice.referencePrice` (see DEVEX_REPORT).
- `simulate`: call the REST endpoint directly with our own request signing, or rely on `minTokensOut`.
- Buy flow: server-side quote, wallet signs approve + swap. First execution needs real USDT on mainnet.

## Deployments

| Network | PlanRegistry (proxy) | Implementation | Verified |
| --- | --- | --- | --- |
| BSC testnet (97) | `0x28daDC35523CE792C7C09faf516763830C38f36b` | `0xD408f733B94Bee65714C0fE99212F47cD55A315C` | [BscScan](https://testnet.bscscan.com/address/0x28daDC35523CE792C7C09faf516763830C38f36b#code) (proxy linked) + Sourcify |

## Run

```sh
git submodule update --init --recursive   # forge-std, OpenZeppelin
pnpm install
pnpm test                     # core + contracts
pnpm dev                      # http://localhost:3000
```

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

Upgrades: write `PlanRegistryV2` annotated `/// @custom:oz-upgrades-from PlanRegistry`, only append fields to
`PlanRegistryStorage`, then `Upgrades.upgradeProxy(proxy, "PlanRegistryV2.sol", "")`. The OZ plugin checks the
storage layout (needs Node, `ffi = true`).
