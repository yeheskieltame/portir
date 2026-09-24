# PlanRegistry — internal audit (2026-09-23)

Scope: `src/PlanRegistry.sol` (UUPS proxy on BSC testnet `0x28daDC35523CE792C7C09faf516763830C38f36b`). Method: line-by-line
review against the OpenZeppelin upgrade-safety checklist, the 13 Foundry tests (incl. fuzz), `forge lint`, and the OZ
Upgrades plugin validation that runs on every deploy/upgrade. The testnet fixtures in `src/testnet/` are out of scope
(non-upgradeable test doubles, never deployed to mainnet).

## What the contract does not do (by design)

- Holds no funds, no token approvals, no external calls: it is a registry of plans and run logs. The worst case of a bug is
  a wrong log line, not lost money. Money moves only through the user's wallet (app) or the Agentic Wallet (executor).

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
| v4 upgrade (2026-09-25) | `resumePlan` reverts `PlanDone` for a once plan whose last run was not Waited (found in the 2026-09-25 review); storage unchanged. Testnet impl `0xe01E…2379` |
| v3 upgrade (2026-09-24) | `Plan.once` appended (packs into the struct's last slot: 27 → 28 bytes, still 4 slots, array layout unchanged); `createPlan` gains a `once` argument; a once plan completes (`active=false`, `PlanCompleted`) after its first non-Waited run. Testnet impl `0x07E0…b6D9` |
| v2 upgrade (2026-09-24) | `updatePlan` / `resumePlan` added; `PlanRegistryStorage`, `Plan` and `Run` unchanged (reviewed by hand: no field added, removed or reordered). `script/Upgrade.s.sol` sets `unsafeSkipStorageCheck` only because the contract keeps its name and the plugin has no reference build; all other plugin checks ran. Testnet impl `0xEb62…d172` |

## Access control

| Function | Who | Notes |
| --- | --- | --- |
| `createPlan` | anyone | plan owner = `msg.sender`; executor is chosen by the owner |
| `cancelPlan` | plan owner | `NotPlanOwner`; inactive plans revert `PlanInactive` |
| `recordRun` | plan executor **or** owner | `NotAuthorized`; owner fallback so a user can log a manual run |
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
| 7 | Info | No reentrancy surface (no external calls, no ETH). | No action |
| 8 | Info | `forge lint`: one intentional `uint40` cast in `recordRun` (`next` ≤ `2^40`), annotated `disable-next-line`. | Verified |

## Pre-mainnet checklist

- [ ] `OWNER` = a multisig (Safe) address; deployer keeps no admin.
- [ ] `forge test --profile ci` (5,000 fuzz runs) green.
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

