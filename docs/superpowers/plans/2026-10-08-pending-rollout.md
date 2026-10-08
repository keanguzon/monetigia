# Pending Rollout Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Follow the already authorized execution method; no repeat approval gate is required. Steps use checkbox syntax.

**Goal:** Complete the pending mobile navigation, overspend confirmation, existing-debt and transaction-editing work, then release verified changes while preserving all user data.

**Architecture:** Reuse the transition-aware navigation and authoritative financial command lane. Opening debt remains an obligation model separate from expense transactions. Financial SQL must be installed before its dependent frontend is pushed to a deployment branch.

**Tech Stack:** Next.js 14, React 18, Tailwind, existing Radix primitives, SWR, Supabase/PostgreSQL, Vitest and native database tests.

**Spec:** [Manual QA requirements](2026-10-07-manual-qa-follow-ups.md), [existing-debt design](../specs/2026-10-07-existing-debt-selection-design.md), [existing-debt implementation plan](2026-10-07-existing-debt-selection.md), and the user's October 8 instructions. This document supersedes stale approval, branch, model and release-status passages in those documents.

## Global constraints

- User has authorized the plan and implementation of all pending items. Start on `codex/mobile-pwa-follow-ups` from main `56ce652`; preserve later work and all user data. No reset, fabricated expenses or invented past payments.
- Antislop during is already resolved as a session override. Preserve Monetigia green, Manrope/Bricolage typography and ENERGY 1 / RHYTHM 2 / MOTION 1. The Apple reference authorizes a floating glass navigation treatment with Monetigia identity.
- Minimum 44px targets, safe-area spacing, readable light/dark themes, keyboard focus, reduced motion and browser zoom. Verify 375px, 768px and 1280px, plus a 320px narrow case.
- Drafts use Sol medium/high. Scoped coding uses Luna max. Difficult implementation uses Sol 6.1 medium/high according to financial/concurrency complexity. Reviews use Sol low/medium. No Astra unless newly requested.
- Physical iOS acceptance requires the user's device. Finish the implementation and available checks, record that acceptance separately, and do not dismiss a feature because physical QA cannot be automated.
- No new offline financial writes, caching of private financial responses, silent request replay, dependency installs or unrelated redesign.
- Apply additive financial migrations before dependent frontend pushes; confirm SQL success and the final installed RPC behavior. Database tests run only against an explicitly disposable database.

## Consolidated inventory

| Item | Current status | Action |
| --- | --- | --- |
| Mobile/PWA bottom navigation | Pending implementation | Task 1 first |
| Overspend separate Keep/Release popup | Inline notice exists; requested popup pending | Task 2 |
| Dated opening debt, remaining installments, Add Wallet footer | Detailed design exists; implementation pending | Tasks 4-6 |
| Installment selection/full-row correction | Pending | Tasks 5 and 7 |
| Transaction and group description edits | Pending | Task 8 |
| Archived Goals in Settings | Existing `b89b591` integrated on current branch as `a61b0f1` | Do not reimplement. User reports successful execution of `202610080001_archived_goal_restore.sql`; integrated verification and next frontend push remain pending |
| Settings first release, installment history/dates, Apple icon | Already implemented | Regression/acceptance only |
| All months outstanding-debt hotfix | Already on main; uses current credit balances | Preserve it. Larger dated opening-debt model remains pending; populated-data acceptance still needed |
| Goal session/focus recovery | Latest recovery code is on main | Production tab-return acceptance remains unverified |

## Review focus

1. Input keyboard versus pinch/text zoom: navigation must avoid keyboard obstruction without disappearing merely because a user zoomed (Task 1).
2. Existing custom overlays and Radix dialogs: navigation and More cannot compete with modal focus or remain clickable behind them (Task 1).
3. Stale quote, double confirmation and unknown outcome: no duplicate expense and no lost recovery request ID (Task 2).
4. Legacy undated balances, partial repayment and reversal after correction: truthful totals, retained cash/payment history and no manufactured expense (Tasks 4-6).
5. Selection or description editing across refresh, sorting and concurrent deletion: stable IDs, atomic stale rejection and no balance changes from text edits (Tasks 7-8).

## Release order

1. Implement and review navigation, then overspend popup. Neither requires a financial migration.
2. Verify archived-goal integration `a61b0f1`, retaining newer main recovery logic. Confirm the user-reported SQL application with a read-only authenticated RPC/schema check and run regression tests against the integrated code. Inspect conflict resolution and record browser QA missing from the older verification report.
3. Implement existing-debt backend contracts/schema/settlement/correction before dependent UI. Choose unused migration filenames after integration; `202610080001` belongs to archived restore.
4. Complete opening-debt UI, selection and text editing. Apply reviewed financial migrations in their chronological order before pushing the dependent frontend to the deployment branch. Do not infer migration success from a frontend build.
5. Run integrated verification and publish an exact release/acceptance record. Continue authorized integration without an additional design or execution-method approval question.

## Task 1: Mobile/PWA floating navigation

**Model:** Luna max; one bounded presentation feature reusing existing routing. Sol medium review focuses on viewport and modal integration.

**Files/interfaces/tests:** The complete executor contract is [task-1-brief.md](../../codex-review/pending-rollout/task-1-brief.md). It owns `MobileNavigation()`, `useMobileNavigationVisibility(): { blockedByModal: boolean; keyboardOpen: boolean }`, dashboard integration, narrow header adjustment and marker-only edits to existing custom modal roots. No financial interfaces change.

- [ ] Execute the brief's failing behavioral tests, scoped implementation and focused checks.
- [ ] Root verifies rendered light/dark, fallback, keyboard, zoom, route and desktop behavior; record device-only limits.
- [ ] Sol medium reviews the diff, fix findings, and commit only the reviewed task under current authorization.

## Task 2: Overspend popup

**Model:** Sol 6.1 medium implementation; existing request/requote semantics and nested focus are material. Sol medium review.

**Files:** `src/components/transactions/GoalReleaseNotice.tsx`, `AddTransactionModal.tsx`; create `GoalReleaseDialog.tsx`; update `tests/transaction-release.test.tsx`.

**Interface:** Consume the existing notice props: `TransactionQuote`, `TransactionDraft`, optional `GoalFinanceSnapshot`, `disabled`, `onChange(ReleaseLine[])`, `onConfirm()`, `onCancel()`. Keep `useTransactionSubmit`'s authoritative request and unresolved-save controller.

- [ ] Add failing tests for required-release popup, Keep reservations/Escape causing no save, Release funds and save writing once, customized releases, stale quote requiring renewed review, unknown outcome retry and successful-refresh auto-close.
- [ ] Implement the separate Radix confirmation; restore underlying-form focus on cancellation and suspend competing dialog interaction. Display actual quote amounts and affected goal names. Keep unresolved and saved-but-refresh-failed feedback reachable.
- [ ] Run `npx vitest run tests/transaction-release.test.tsx`, `npx tsc --noEmit`, and rendered mobile/keyboard checks. Review and commit.

## Task 3: Release existing archived-goal implementation

**Model:** Luna max for bounded integration and tests; Sol medium for financial migration/recovery conflict review.

**Files:** Reuse the exact files in `git show --stat b89b591`, including `src/components/settings/ArchivedGoalsSection.tsx` and `supabase/migrations/202610080001_archived_goal_restore.sql`; reuse that commit's verification document. No second restore implementation.

**Interface:** Existing `goal_restore_archived(p_request_id uuid, p_goal_id uuid)` returns the financial result; clears archival metadata while retaining completed/cancelled state. Reopen remains separate.

- [x] Root integrated `b89b591` as `a61b0f1`. Do not cherry-pick it again.
- [ ] Inspect the integrated cache-refresh changes against newest main session recovery. The user reported migration success; record it as user-reported evidence until the runtime check confirms availability.
- [ ] Run focused archived UI/client/DB tests on the final integrated state. Verify ownership, replay, unchanged balances/history, restore to closed goals, uncertain save and refresh failure.
- [ ] Complete missing Settings browser checks, record evidence, review and release under current authorization once the migration prerequisite is confirmed.

## Tasks 4-8: Existing debt and editing, using the detailed plan

The [existing-debt plan](2026-10-07-existing-debt-selection.md) remains the authoritative file map, signatures and test steps. Execute these groups in dependency order; do not rewrite its already specified algorithms or introduce a second contract.

| Rollout task | Detailed-plan tasks | Implementation model and rationale | Review |
| --- | --- | --- | --- |
| 4. Exact schedule and creation schema | 1-2 | Luna max for pure schedule validation; Sol 6.1 high for secured atomic account creation, RLS and replay | Sol medium |
| 5. Settlements and corrections | 3 and 5 | Sol 6.1 high for partial settlement, reversal, stale batches and financial invariants | Sol medium |
| 6. Snapshot/adoption and Add Wallet | 4 and 6 | Sol 6.1 high for legacy adoption/reconciliation; Luna max for scoped shared fields/fixed-footer UI after contracts exist | Sol medium |
| 7. Selection and full-row state | 7 | Luna max for stable-ID UI and keyboard behavior using reviewed correction command | Sol medium |
| 8. Description/group editing | 8 | Sol 6.1 medium for guarded metadata command; Luna max for bounded detail/group editor after contract exists | Sol medium |

For each grouped task:

- [ ] Read the referenced task's Files/Interfaces and implement its exact failing tests before code.
- [ ] Run its focused tests, implement the smallest reviewed change, run the tests/typecheck and record the result.
- [ ] Review and commit each independently testable deliverable before the next dependent task.

**Corrections to stale passages:** All months balance omission is fixed on main, so retain that hotfix and extend scheduled projections rather than recreate it. Opening-debt schedules/adoption are still unimplemented. This rollout authorizes execution of the debt plan, superseding its planning-only boundary and old branch/model restrictions. Preserve strict digits-only counts, 2 and 24 months, 600 safety cap, exact centavos, original-day clamping, multiple named debts, due dates, no expense fiction, fixed Add Wallet footer, group-scoped selection, Shift range, select/deselect all, full-row states, unpaid-only correction with paid history retained, and description-only text editing with stable group IDs.

## Task 9: Integrated checks and acceptance record

**Model:** Luna medium/high for bounded evidence collection; Sol medium whole-branch review. Financial diagnosis discovered during checking returns to Sol 6.1 medium/high.

**Files:** Create `docs/codex-review/PENDING_ROLLOUT_VERIFICATION.md`; update the portable handoff with actual completed status and migration order.

- [ ] Run `npx tsc --noEmit`, `npm test`, `npm run test:db` on an explicitly disposable database, `npm run lint`, and production build sequentially. Use `MONETIGIA_BUILD_DIR=.next-verification` for the build to protect any active preview. Record current exits/counts; do not reuse historical counts.
- [ ] Ensure the full migration sequence is installed last, then test the final dispatcher. Do not reset production or user QA data.
- [ ] Root click-through: navigation/More; popup decline/confirm/requote/recovery; restored closed goal then separate reopen; opening debt with 2/24 months; authoritative totals and month projections; payment/reversal; unpaid/partial correction; text/group edits with unchanged money.
- [ ] Record screenshots/layout measurements at target widths/themes and keyboard/reduced-motion/zoom behavior. Record physical Safari/Home Screen keyboard/safe-area and production 10-15 second tab-return checks as pending until observed on the user's device.
- [ ] Run antislop Hard/Purpose/Liveliness/Craftsmanship gates with actual implementation evidence; obtain whole-branch review, fix findings and complete the authorized migration-before-frontend release.

## Planning self-review

All pending items map to tasks; existing completed code is classified separately. The five review-focus conditions have named task checks. Financial interfaces are reused from the detailed debt plan. The first task is bounded by a separate brief. Planning inspection does not claim implementation, test success or physical-device acceptance.
