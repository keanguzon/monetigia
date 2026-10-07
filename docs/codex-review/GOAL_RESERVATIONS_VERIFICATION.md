# Goal Reservations: Whole-Flow Verification & Delivery Evidence

**Branch:** `codex/goal-reservations`  
**Date:** 2026-10-07  
**Status:** Verification Complete & Approved (Sign-off Ready)

---

## 1. Executive Summary

This document certifies that the **Goal Reservations and Spending Lifecycle Architecture** (Tasks 1 through 11) is fully implemented, verified, and ready for deployment review. 

All core accounting invariants, PostgreSQL database triggers, atomic RPC operations, SWR state management, and user-facing dialogs have passed automated and browser-based verification without regressing existing workspace functionality.

---

## 2. Sequential Verification Suite Results

Executed sequentially on the final code state within the worktree:

| Command | Exit Code | Tests / Status | Log Artifact | Details |
| :--- | :---: | :---: | :--- | :--- |
| `npx tsc --noEmit` | **0** | Clean | `task-11-tsc.log` | Zero TypeScript errors across all application and test files. |
| `npm test` | **0** | **138 Passed** (0 Failed) | `task-11-npm-test.log` | **7 Node** (navigation & CSP tests) + **131 Vitest** (contracts, domain math, hooks, modals, release dialogs). |
| `npm run test:db` | **0** | **71 Passed** (0 Failed) | `task-11-db-test.log` | Real PostgreSQL & PostgREST test harness verifying locking, RLS, triggers, atomic rollbacks, and security definers. |
| `npm run lint` | **0** | **6 Baseline Warnings** | `task-11-lint.log` | Verified clean: exactly six pre-existing `react-hooks/exhaustive-deps` warnings; zero new warnings introduced. |
| `npm run build` | **0** | **20 Pages Generated** | `task-11-build.log` | Next.js 14.1.0 production bundle compiled successfully; static & dynamic routes validated. Nonfatal build warnings documented below. |

### Documented Nonfatal Build Warnings
As recorded in `task-11-build.log`:
1. *Bricolage Grotesque Font Override:* Pre-existing local font fallback notice.
2. *Edge Runtime API Warning:* `@supabase/supabase-js` process version access in Edge runtime middleware (existing Supabase SSR library behavior).
3. *Webpack Cache String Serialization:* Standard Next.js cache serialization notice for chunks > 100kiB.
4. *Browserslist Data:* caniuse-lite update notice.

---

## 3. Disposition of the Five Core Review Focus Cases

Directly addressing the five architectural failure cases mandated in the implementation plan (`2026-10-06-goal-reservations.md`):

| Review Focus Case | Dilemma & Risk | Implemented Invariants | Concrete Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Review Focus 1**<br>*(Stale Quote Race)* | A second tab changes funds while a warning is open: reject a stale quote without releasing or spending money. | Transaction drafts obtain a fingerprinted quote. When committing, `goal_finance_apply` checks quote hash against current database state. Mismatches abort atomically with `STALE_QUOTE`. | • `tests/database/financial-transactions.test.mjs:156` (asserts full rollback of balances, operations, and events).<br>• Multi-tab browser test (Tab B mutated reservation; Tab A submission failed cleanly without duplicate deduction). |
| **Review Focus 2**<br>*(Timeout & Request Replay)* | A timeout occurs after the save committed: retry the same request ID and recover its result without duplication. | `financial_operation` ledger deduplicates requests using caller UUID. Replaying the identical request returns the cached result without creating new allocation events or double-charging. | • `tests/database/reservations.test.mjs:174` & `tests/database/financial-transactions.test.mjs:249` (request replay retains original result).<br>• `tests/goal-actions.test.tsx:210` & `tests/transaction-release.test.tsx:352` (unknown save recovers across dialog re-openings). |
| **Review Focus 3**<br>*(Multi-Goal Shortfall Release)* | Several goals share one wallet: release exactly the confirmed shortfall from that wallet with predictable priority ordering. | Release engine calculates deterministic shortfall: non-priority first, furthest date first, newest first. The user can manually edit release line allocations in the confirmation dialog. | • `tests/database/financial-transactions.test.mjs:164` (custom release must match exact shortfall from paying wallet).<br>• `tests/transaction-release.test.tsx:142` (custom release inputs quote chosen goals before confirmation). |
| **Review Focus 4**<br>*(Purchase Deletion on Closed Goal)* | A purchase is deleted after its goal closed: reverse accounting without silently reopening the goal or restoring a closed reservation. | Deleting a goal expense reverses the spent allocation and restores wallet cash. If the goal is closed, it increases available money without reopening the goal or restoring closed reservations. | • `tests/database/goal-lifecycle.test.mjs:236` (`deletion preserves closed goal state`).<br>• `tests/database/goal-lifecycle.test.mjs:245` (`ordinary expense release reversal respects closed goal`). |
| **Review Focus 5**<br>*(Direct Writes & Legacy RPCs)* | An old client uses direct writes or an old deletion RPC: database permissions prevent bypassing reservation invariants. | Direct table writes to allocation amounts and balances are blocked via PostgreSQL triggers and RLS. Client must execute authoritative RPCs. Zero targets are rejected while zero allocations remain valid. | • `tests/database/migration-security.test.mjs:120` (`authenticated direct finance writes fail`).<br>• `tests/database/migration-security.test.mjs:240` (`authenticated zero-target goal creation is denied`).<br>• `tests/database/migration-security.test.mjs:253` (`zero-target updates leave snapshot intact`). |

---

## 4. Evidence Mapping for Key User Scenarios

| Scenario | Architectural Flow | Automated Test Evidence | Browser Preview Evidence |
| :--- | :--- | :--- | :--- |
| **₱28,000 Confirmed Overspend** | Spending beyond available funds triggers `ConfirmReleaseDialog` to release reservation shortfall from paying wallet. | `tests/database/financial-transactions.test.mjs` (*"confirmed overspend releases only its shortfall"*) | Rendered `ConfirmReleaseDialog` prompt on expense entry; release breakdown verified before write. |
| **Installment / Debt Payment** | Credit goal-tagged installments are informational tags; card debt books once and does not reserve cash funds. | `tests/database/financial-transactions.test.mjs` (*"credit installments distribute centavos and book debt once"*) & `tests/contributions.test.tsx` | Credit card purchase with installment choice tested; verified zero phantom reservation in wallet summary. |
| **Transaction Reversal / Deletion** | Deleting a transaction reverses associated allocation events atomically and restores original wallet state. | `tests/database/goal-lifecycle.test.mjs` (*"deletion restores active reservations and retains source event and transaction UUID"*) | Transaction deletion in activity list correctly restored goal reservation back to available balance. |
| **Archive & Reopen Goal** | Closed goals can be archived once reservations reach zero; reopening returns goal to active state with history intact. | `tests/database/goal-lifecycle.test.mjs` (*"cancel, reopen, and archive retain spending; archive requires closed zero reservations"*) | Goal card action menu: Archive/Reopen tested on completed Laptop and Date goals; closed goals filtered from active views. |
| **Cancel / Failed Save** | Dismissing action dialogs or experiencing network rejections leaves the finance snapshot untouched. | `tests/contributions.test.tsx` (*"failed save and cancellation do not add funding; Escape closes dialog"*) & `tests/goal-actions.test.tsx` | Tested Escape key and Cancel button across Set Aside and Release dialogs; snapshot verified unchanged. |
| **Legacy Adoption** | Existing goals default to `needs_review` state; historical cash spending can be explicitly reconciled without double-charging. | `tests/legacy-goals.test.tsx` (*"unreviewed goal opens review and cannot spend or reserve legacy tagged money"*) & `tests/database/migration-security.test.mjs` | Unreviewed goal banner displays review guidance; fake savings explanation prevents phantom deductions. |

---

## 5. Browser Smoke Test, Viewport Matrix & UI Hygiene

Verified on local preview (`http://127.0.0.1:3000` with local API `127.0.0.1:55440`):

- **Viewport Reflow:**
  - `375px` (Mobile): Card stacks reflow cleanly; zero horizontal overflow; all tap targets >= 44px.
  - `768px` (Tablet): Two-column summary grid with hairline dividers intact.
  - `1280px` (Desktop): Full four-column cards; modal overlays properly centered.
- **Themes & Contrast:** Validated across Light Mode and Dark Mode; color contrasts comply with WCAG AA.
- **SWR Cache Eviction Bug Resolved:** Fixed in `src/hooks/use-goal-finance.ts` and verified with `tests/goal-finance-hooks.test.tsx` (`an unauthenticated finance consumer does not clear a mounted user's snapshot`). Cache eviction triggers only on genuine sign-out (`previousUserId !== null && userId === null`).
- **Keyboard Navigation:** Full Tab, Enter, and Escape support in all financial action dialogs.

---

## 6. Preflight Deployment Checklist & Unresolved Risks

> [!WARNING]
> This branch does **NOT** apply live migrations or deploy to production. Follow these preflight steps when executing the production release:

1. **Database Migration Order:** Apply migrations `202610060001` through `202610060006` sequentially:
   - `202610060001_runtime_baseline.sql`
   - `202610060002_goal_allocation_ledger.sql`
   - `202610060003_goal_finance_operations.sql`
   - `202610060004_transaction_linkage.sql`
   - `202610060005_lifecycle_reversals.sql`
   - `202610060006_goal_write_guards.sql`
2. **RPC Function Registration & Security Definers:**
   - Confirm all financial RPCs (`goal_finance_snapshot`, `goal_finance_apply`, `goal_transaction_quote`) are registered with `SECURITY DEFINER`.
   - **MANDATORY:** Verify search path is pinned exactly to:
     ```sql
     SET search_path = pg_catalog, public;
     ```
3. **Legacy Data Review:** Ensure existing goals are initialized with `review_state = 'needs_review'` so users can reconcile legacy allocations before ledger operations are applied.
4. **Environment Variables:** Production CSP in `next.config.js` remains strict (loopback API allowed only in development).
