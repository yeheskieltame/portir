# PlanRegistry — internal audit (2026-09-23)

Scope: `src/PlanRegistry.sol` (UUPS proxy on BSC testnet `0x28daDC35523CE792C7C09faf516763830C38f36b`). Method: line-by-line
review against the OpenZeppelin upgrade-safety checklist, the 13 Foundry tests (incl. fuzz), `forge lint`, and the OZ
Upgrades plugin validation that runs on every deploy/upgrade. The testnet fixtures in `src/testnet/` are out of scope
(non-upgradeable test doubles, never deployed to mainnet).

## Trust model

- Holds no funds between calls. Since v5 it **moves tokens**: owners approve the registry (never the agent EOA) for the
  funding token, and for stock tokens of sell rules. `pullFunds` / `pullShares` move at most `plan.amount` per scheduled
  run from the owner to the plan's executor; `returnFunds` / `returnShares` send unspent money back. A leaked executor
  key can take at most one run's amount per due plan and interval (≥ 1 day), not the owner's whole allowance.
- External calls: `safeTransferFrom` on the funding token and on the token a sell rule names. State is updated before
  the call. A sell rule's token is chosen by its owner, so a hostile token can only reenter that owner's own plans.
- The contract owner is fully trusted: `upgradeToAndCall` can replace the logic and reach every allowance given to the
  registry, and `setFundingToken` chooses which token `pullFunds` moves. Mainnet owner must be a multisig. The app asks
  for 12 runs of allowance, not unlimited, which bounds the damage of a compromised owner per user.

## Upgradeability

| Check | Result |
| --- | --- |
| Pattern | UUPS (`UUPSUpgradeable`), proxy `ERC1967Proxy`, deployed with `Upgrades.deployUUPSProxy` |
| `_authorizeUpgrade` | `onlyOwner` (`Ownable2StepUpgradeable`: transfer needs acceptance, no fat-finger loss of admin) |
| Implementation locked | constructor calls `_disableInitializers()`; test `test_Initialize_OnlyOnceAndImplementationLocked` |
| Initializer | `initialize(address)` with `initializer`; only `__Ownable_init` (no other parent needs init) |
| Storage | ERC-7201 namespace `portir.storage.PlanRegistry`; slot constant verified; no state outside the struct |
| Upgrade path | `test_Upgrade_OnlyOwnerAndKeepsState` upgrades to a V2 and reads back plans; plugin validates layout |
| Admin | testnet owner = deployer EOA. **Mainnet: deploy with `OWNER=<multisig>`** (script supports it) |
| v5 upgrade (2026-09-25) | Funded runs: owners approve PlanRegistry (never the agent EOA); `pullFunds` lets only the plan executor move at most `plan.amount` per scheduled run, only while the run is due and active; `returnFunds` gives unspent money back and frees that run's budget. Storage: `fundingToken` and `funding` appended to the ERC-7201 struct (no existing field moved). A leaked executor key can take at most one run's amount per due plan, not the owner's whole allowance. Testnet impl `0x3913…Af44`, funding token = existing tUSDT |
| v4 upgrade (2026-09-25) | `resumePlan` reverts `PlanDone` for a once plan whose last run was not Waited (found in the 2026-09-25 review); storage unchanged. Testnet impl `0xe01E…2379` |
| v3 upgrade (2026-09-24) | `Plan.once` appended (packs into the struct's last slot: 27 → 28 bytes, still 4 slots, array layout unchanged); `createPlan` gains a `once` argument; a once plan completes (`active=false`, `PlanCompleted`) after its first non-Waited run. Testnet impl `0x07E0…b6D9` |
| v2 upgrade (2026-09-24) | `updatePlan` / `resumePlan` added; `PlanRegistryStorage`, `Plan` and `Run` unchanged (reviewed by hand: no field added, removed or reordered). `script/Upgrade.s.sol` sets `unsafeSkipStorageCheck` only because the contract keeps its name and the plugin has no reference build; all other plugin checks ran. Testnet impl `0xEb62…d172` |

## Access control

| Function | Who | Notes |
| --- | --- | --- |
| `createPlan` | anyone | plan owner = `msg.sender`; executor is chosen by the owner |
| `cancelPlan` | plan owner | `NotPlanOwner`; inactive plans revert `PlanInactive` |
| `recordRun` | plan executor **or** owner | `NotAuthorized`; owner fallback so a user can log a manual run |
| `updatePlan` / `resumePlan` | plan owner | `resumePlan` refuses a finished once plan (`PlanDone`) |
| `pullFunds` / `pullShares` | plan executor | active and due only; at most `plan.amount` per run; buy plans pull the funding token, sell rules their token (`WrongPlanKind`) |
| `returnFunds` / `returnShares` | plan executor | at most what was pulled for the run; open while paused and after the run is recorded |
| `setFundingToken` | owner | |
| `upgradeToAndCall` | owner (2-step) | |

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Info | `recordRun` with `Executed` advances `nextRunAt` even when `txHash == 0`. Acceptable: the executor is trusted per plan; the app shows the hash. | Documented |
| 2 | Info | `plans` array grows unbounded; `planIdsOf` returns a full array. Both are view-only; no loop in any state-changing path. | No action |
| 3 | Low | No `updatePlan`: changing amount/cadence means cancel + create (new planId). UX cost only. | Backlog |
| 4 | Info | `uint40` timestamps: fine until year 36812. `interval` is `uint32` (max ~136 years). | No action |
| 5 | Info | `firstRunAt` in the past is clamped to `block.timestamp`: a plan is due immediately, which is the intended "run at creation" semantics. | Documented |
| 6 | Info | `MAX_REASON_LENGTH = 200` bounds event/log size; longer reasons revert `ReasonTooLong`. Executor truncates before sending. | Verified |
| 7 | Info | No reentrancy surface (no external calls, no ETH). Superseded since v5: see Trust model and the 2026-10-03 review. | Superseded |
| 8 | Info | `forge lint`: one intentional `uint40` cast in `recordRun` (`next` ≤ `2^40`), annotated `disable-next-line`. | Verified |

## Pre-mainnet checklist

- [ ] `OWNER` = a multisig (Safe) address; deployer keeps no admin.
- [ ] `FOUNDRY_PROFILE=ci forge test` (5,000 fuzz runs) green.
- [ ] `pnpm deploy:mainnet` → verify on BscScan (implementation + proxy, `script/verify.sh bsc <proxy>`).
- [ ] App `NEXT_PUBLIC_CHAIN=mainnet`, `NEXT_PUBLIC_PLAN_REGISTRY=<proxy>`, executor address set in every plan.
- [ ] Executor dry run against the mainnet registry with `PORTIR_EXECUTION=off` for one scan before enabling execution.

## Review 2026-09-25 (adversarial pass, 3,000 fuzz runs, `forge lint` clean)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | `resumePlan` could reactivate a **completed** once plan (bought or given up): the UI showed "Done" while the executor would buy again. | Medium | **Fixed** in `PlanRegistry.resumePlan` (`PlanDone` when the last run of a once plan is not Waited); test `test_ResumePlan_PausedOncePlanResumes_CompletedOnceDoesNot`. Needs a UUPS **upgrade** (v4, no storage change) — not deployed by this review. |
| 2 | TestExchange quote binds `(stock, price, deadline)` only: anyone may reuse a quote for any amount, buy or sell, until the deadline (10 min). | Low (testnet fixture) | **Accepted**, documented by `test_Quote_IsReusableUntilDeadline_Documented`. A real venue must bind buyer, side and amount. |
| 3 | `buyBatch` is all-or-nothing and unbounded in `n`; gas grows with legs. | Info | Accepted (baskets have ≤ 6 legs). |
| 4 | TestExchange uses single-step `Ownable`; `setKeeper(0)` effectively pauses trading (every recover mismatches). | Info | Accepted for testnet; PlanRegistry keeps `Ownable2Step`. |
| 5 | `recordRun` may be called by the plan owner (owner-run fallback), so an owner can log a fake Executed for their own plan. | Info | By design; only affects the owner's own history. |
| 6 | Fee math rounds shares down; `usdtIn * (10000 − fee) * 1e18` overflows only above 1e52 wei. | Info | Accepted. |
| 7 | MockUSDT faucet: first call allowed (`last == 0`), exactly at `nextAt` allowed, one second before reverts; unlimited across addresses. | Info | Accepted (testnet). |
| 8 | Once plan finished by `Skipped` (window over) shows as `active=false`; the app labels every inactive once plan "Done" even when nothing was bought. | UX | Out of scope here; the app should read the last run's outcome. |

No change to `TestExchange`, `MockUSDT` or `MockStock` sources: **no redeploy needed**. Only `PlanRegistry` changed (finding 1) and needs an in-place upgrade when the operator chooses to ship it.

## LoanGuard (2026-09-27)

| Check | Result |
| --- | --- |
| Pattern | UUPS, ERC-7201 `portir.storage.LoanGuard` (slot computed), `_disableInitializers`, `_authorizeUpgrade` onlyOwner (Ownable2Step) |
| Funds | Never held: `rescue` pulls exactly `amount` from the borrower and repays Venus in the same call (`forceApprove` + `repayBorrowBehalf`) |
| Authorization | Only the executor the borrower chose; `amount ≤ maxPerRescue`; once per `cooldown`; borrower can `cancelGuard` or revoke the allowance any time |
| Risk check on-chain | Rescue reverts `NotAtRisk` unless `usedBps ≥ triggerBps`, computed from Venus' oracle, `getAccountSnapshot` and the liquidation threshold (4th word of `markets()`, decoded by position for version drift) |
| Venus error codes | vTokens return codes instead of reverting; non-zero → `VenusError(code)` |
| Worst case, leaked executor key | Repays part of the borrower's own debt from their approved buffer, capped and rate-limited. No transfer to anyone else |
| Accepted | `getAssetsIn` loop is bounded by the markets a borrower entered; oracle trust is Venus' own; `borrowers` list only grows (view, used for off-chain scanning because public RPCs block eth_getLogs) |
| Deploy | Implementation + ERC1967Proxy deployed directly (the upgrades plugin trips over two OZ copies in lib/); v2 appended `borrowers` and `rescues`. Testnet proxy `0xD48C…bab3`, impl `0x1e7e…E242` |
| Tests | 6 unit (mock Venus) + fork test against the BSC testnet core pool |

## StockLendingPool (testnet fixture, 2026-09-28)

Venus-compatible stand-in because Venus has no stock markets on testnet. Not upgradeable, not for mainnet (mainnet uses
Venus). Borrow limit Σ collateral × CF; liquidation when debt > Σ collateral × LT; close factor 50%, bonus 10%;
1 vToken = 1 underlying, no interest. Checks: borrow/redeem update state first and revert via the pool hook if the
account ends under-collateralised; stale prices (> 1h) block borrow, redeem and liquidation; only the keeper/owner set
prices and the stablecoin market stays at $1; only the pool can `seize`/`repayFor`. Tests: 5 (limits, stale price,
LoanGuard rescue after a price drop, liquidation math, repay-all and price auth). Deployed with 18 stock markets,
all 22 contracts verified.


## PlanRegistry v6: sell rules (2026-09-28)

- `createSellRule` stores a one-time plan whose `amount` is shares of `SellRule.token`, plus the trigger price and direction. Storage: one mapping appended to the namespaced struct (`sellRules`); `Plan` is unchanged, since it lives in an array and must keep its size.
- `pullShares` / `returnShares` reuse the per-run budget accounting of `pullFunds`: executor only, while active and due, at most `amount` shares in total. A sell rule can never pull the stablecoin, and a buy plan can never pull shares (`WrongPlanKind`, both directions tested).
- The trigger is checked by the executor off-chain against the live exchange price, the same trust model as the Guard for buys: the contract bounds how much can move, not when. Proceeds are sent to the owner by the executor.
- Allowances: the app approves the registry for `current allowance + shares`, so several rules on one stock do not overwrite each other.
- Testnet: implementation `0x03A4C05c7a44A6B732a8D4CDa42C2a4A14Fe6806`, verified. End-to-end run: rule #14 sold 0.215 NVDA at $231.92 for $49.81 once NVDA crossed $230, then completed.

## Review 2026-10-03 (pre-mainnet, 5,000 fuzz runs, `forge lint` clean)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | `resumePlan` moved an overdue `nextRunAt` to now, which also reset the run's pulled budget: pull 50, pause, resume a second later, pull 50 again in the same period. Owner-triggered only, but it broke "at most `amount` per run". | Medium | **Fixed**: resume carries the run's funding over to the new `nextRunAt`. Test `test_PauseResume_KeepsRunBudget`. |
| 2 | `returnFunds` / `returnShares` required the run to be active and due, so pausing a plan mid-run, or recording the run first, left the executor holding the owner's money with no way back through the registry. | Medium | **Fixed**: returns only check the executor and the pulled amount. Test `test_ReturnFunds_OpenWhilePausedAndAfterRecord`. |
| 3 | The "does not move funds / no external calls" statements above were written before v5 and no longer held. | Docs | **Fixed** (Trust model, access table). |
| 4 | Owner is an EOA on testnet; with UUPS and user allowances, the owner key is the single point of failure. | High for mainnet | Open until mainnet: deploy with `OWNER=<Safe>`. |

Storage unchanged (no field added or moved), ABI unchanged: testnet takes an in-place upgrade, mainnet a fresh deploy. Testnet implementation `0xf55A8d7050950F5869A649A189ccC7927F92af89` (v7), verified; 16 plans, owner and funding token intact after the upgrade.

Executor fixes in the same pass (`apps/portiragent`): the Agentic Wallet is checked (session, daily limit) before any
money is pulled; a submitted swap is never refunded (pending orders are reported, not retried); exactly the shares a
swap produced are delivered (no more "send max"); explicit slippage (`PORTIR_SLIPPAGE_PCT`, default 1%); the executable
price must pass the Guard, a missing exchange price refuses the buy; a run with money still out blocks new buys until the
operator settles it; failed buys back off 30 minutes; plans under $1 or without balance and allowance get no on-chain
entries (gas griefing).
