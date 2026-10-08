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
- Latest user model policy: Sol medium drafts, Luna max implements bounded scopes, Sol low reviews. Earlier completed tasks retain their actual historical executor records. No Astra.
- Physical iOS acceptance requires the user's device. Finish the implementation and available checks, record that acceptance separately, and do not dismiss a feature because physical QA cannot be automated.
- No new offline financial writes, caching of private financial responses, silent request replay, dependency installs or unrelated redesign.
- Apply additive financial migrations before dependent frontend pushes; confirm SQL success and the final installed RPC behavior. Database tests run only against an explicitly disposable database.

## Consolidated inventory

| Item | Current status | Action |
| --- | --- | --- |
| Mobile/PWA bottom navigation, mobile sorting and recovery | Complete: `7c5b18a`; user QA accepted, checkpoint `7581f93` | No reimplementation; integrated regression/device acceptance only |
| Overspend separate Keep/Release popup | Complete: `cb402e4`; reviewed and browser checked | No reimplementation; integrated regression only |
| Exact opening-debt schedules | Complete: `ef9282a` | Reuse helper; no duplicate purchase schedule |
| Atomic opening-debt creation backend | Complete: `98bffb7`; reviewed, focused DB/contract/type checks passed | Production migration/runtime verification remains a release prerequisite |
| Payment allocations/reversals and unpaid corrections | Money extraction `ace3917` and private adapter/storage `c34d6b4` complete; payment integration 5.1c in progress, correction 5.2 pending | Task 5; reuse current financial command lane |
| Debt snapshot/adoption, Add Wallet fields and fixed footer | Pending | Task 6; creation backend already exists |
| Installment selection/full-row correction | Pending | Tasks 5 and 7 |
| Transaction and group description edits | Pending | Task 8 |
| Archived Goals in Settings | Complete implementation: `a61b0f1`; local Settings rendering and 7 disposable DB checks passed | Do not reimplement. Production migration success is user-reported; authenticated production RPC/release verification remains pending |
| Settings first release, installment history/dates, Apple icon | Already implemented | Regression/acceptance only |
| All months outstanding-debt hotfix | Already on main; uses current credit balances | Preserve it. Larger dated opening-debt model remains pending; populated-data acceptance still needed |
| Goal session/focus recovery | Latest recovery code is on main | Production tab-return acceptance remains unverified |

## Review focus

1. Input keyboard versus pinch/text zoom: navigation must avoid keyboard obstruction without disappearing merely because a user zoomed (Task 1).
2. Existing custom overlays and Radix dialogs: navigation cannot compete with modal focus or remain clickable behind them (Task 1; mobile More was removed).
3. Stale quote, double confirmation and unknown outcome: no duplicate expense and no lost recovery request ID (Task 2).
4. Legacy undated balances, partial repayment and reversal after correction: truthful totals, retained cash/payment history and no manufactured expense (Tasks 4-6).
5. Selection or description editing across refresh, sorting and concurrent deletion: stable IDs, atomic stale rejection and no balance changes from text edits (Tasks 7-8).

## Release order

1. Navigation and overspend popup are implemented and reviewed. Retain them for integrated regression; neither requires a financial migration.
2. Verify archived-goal integration `a61b0f1`, retaining newer main recovery logic. Confirm the user-reported SQL application with a read-only authenticated RPC/schema check and run regression tests against the integrated code. Inspect conflict resolution and record browser QA missing from the older verification report.
3. Implement existing-debt backend contracts/schema/settlement/correction before dependent UI. Choose unused migration filenames after integration; `202610080001` belongs to archived restore.
4. Complete opening-debt UI, selection and text editing. Apply reviewed financial migrations in their chronological order before pushing the dependent frontend to the deployment branch. Do not infer migration success from a frontend build.
5. Run integrated verification and publish an exact release/acceptance record. Continue authorized integration without an additional design or execution-method approval question.

## Task 1: Mobile/PWA floating navigation

**Status:** Complete in `7c5b18a`; user QA accepted in `7581f93`. Historical implementation/reviews are recorded in the linked reports. Latest icons-only, five equal slots and Categories instead of More override earlier presentation requirements.

**Files/interfaces/tests:** The complete executor contract is [task-1-brief.md](../../codex-review/pending-rollout/task-1-brief.md). It owns `MobileNavigation()`, `useMobileNavigationVisibility(): { blockedByModal: boolean; keyboardOpen: boolean }`, dashboard integration, narrow header adjustment and marker-only edits to existing custom modal roots. No financial interfaces change.

- [x] Implemented, focused checks passed, review fixes completed and committed.
- [x] Available browser light/dark, narrow layout, route/recovery/filter/modal and desktop checks recorded; user manual QA accepted.
- [ ] Physical Safari/Home Screen keyboard and text-zoom acceptance remain separate device checks; do not reopen completed implementation for these.

## Task 2: Overspend popup

**Status:** Complete in `cb402e4`; historical Sol implementation/review retained. No new popup implementation required.

**Files:** `src/components/transactions/GoalReleaseNotice.tsx`, `AddTransactionModal.tsx`; create `GoalReleaseDialog.tsx`; update `tests/transaction-release.test.tsx`.

**Interface:** Consume the existing notice props: `TransactionQuote`, `TransactionDraft`, optional `GoalFinanceSnapshot`, `disabled`, `onChange(ReleaseLine[])`, `onConfirm()`, `onCancel()`. Keep `useTransactionSubmit`'s authoritative request and unresolved-save controller.

- [x] Separate confirmation and required-release/custom/stale/recovery tests implemented; controlled draft/focus/scroll retained.
- [x] Review findings fixed, 36 focused tests and typecheck passed; root browser cancellation/requote/theme/layout checks completed and committed.
- [ ] Integrated write-path acceptance remains part of Task 9; browser checks above performed no financial save.

## Task 3: Release existing archived-goal implementation

**Status:** Implementation/integration complete. Remaining work is production runtime/release verification, not another implementation.

**Files:** Reuse the exact files in `git show --stat b89b591`, including `src/components/settings/ArchivedGoalsSection.tsx` and `supabase/migrations/202610080001_archived_goal_restore.sql`; reuse that commit's verification document. No second restore implementation.

**Interface:** Existing `goal_restore_archived(p_request_id uuid, p_goal_id uuid)` returns the financial result; clears archival metadata while retaining completed/cancelled state. Reopen remains separate.

- [x] Root integrated `b89b591` as `a61b0f1`. Do not cherry-pick it again.
- [x] Integrated cache/session code checked; focused client/hooks 23, Settings 36 and disposable archived DB 7 checks passed.
- [x] Read-only Settings archive rendering checked at 375/768/1280 without settled overflow; Restore target 44px.
- [ ] Verify authenticated production RPC availability and release. User reports SQL success; read-only rendering is not proof of a restore write.

## Tasks 4-8: Existing debt and editing, using the detailed plan

The [existing-debt plan](2026-10-07-existing-debt-selection.md) remains the authoritative file map, signatures and test steps. Execute these groups in dependency order; do not rewrite its already specified algorithms or introduce a second contract.

| Rollout task | Detailed-plan tasks | Implementation model and rationale | Review |
| --- | --- | --- | --- |
| 4. Exact schedule and creation schema | 1-2 | Complete: `ef9282a`, `98bffb7`; reuse reviewed implementation | Complete |
| 5. Settlements and corrections | 3 and 5 | Luna max, scopes 5.1a/b/c then 5.2 in task-5 brief | Sol low per scope |
| 6. Snapshot/adoption and Add Wallet | 4 and 6 | Luna max, separate backend/client/shared-fields/consumer scopes | Sol low per scope |
| 7. Selection and full-row state | 7 | Luna max, stable-ID UI using reviewed correction command | Sol low |
| 8. Description/group editing | 8 | Luna max, separate guarded metadata command and editor scopes | Sol low |

For each grouped task:

- [ ] Read the referenced task's Files/Interfaces and implement its exact failing tests before code.
- [ ] Run its focused tests, implement the smallest reviewed change, run the tests/typecheck and record the result.
- [ ] Review and commit each independently testable deliverable before the next dependent task.

**Corrections to older plans:** All months balance omission is fixed on main. Opening-debt schedules and creation backend are now implemented; adoption and UI remain pending. October 7 purchase grouping/history/dates (`da7705b`) and Settings (`67b68ca`) are existing code to reuse. October 7 existing-debt selection plan (`7fc41dd`) was documentation only, confirmed by `BETA_INTEGRATION_VERIFICATION.md`. Before every scope inspect current source and history; skip completed behavior and do not create a duplicate financial lane/table/UI. Preserve digits-only counts, 2/24/600 months, exact centavos, original-day clamping, multiple named debts, due dates, fixed footer, group-scoped selection/Shift/select-all, full-row states, retained paid history and description-only edits.

## Task 9: Integrated checks and acceptance record

**Model:** Luna max for bounded checks/fixes; Sol low whole-branch review. Sol medium drafts any newly required fix scope.

**Files:** Create `docs/codex-review/PENDING_ROLLOUT_VERIFICATION.md`; update the portable handoff with actual completed status and migration order.

- [ ] Run `npx tsc --noEmit`, `npm test`, `npm run test:db` on an explicitly disposable database, `npm run lint`, and production build sequentially. Use `MONETIGIA_BUILD_DIR=.next-verification` for the build to protect any active preview. Record current exits/counts; do not reuse historical counts.
- [ ] Ensure the full migration sequence is installed last, then test the final dispatcher. Do not reset production or user QA data.
- [ ] Root click-through: five direct mobile destinations and profile Settings; popup decline/confirm/requote/recovery; restored closed goal then separate reopen; opening debt with 2/24 months; authoritative totals and month projections; payment/reversal; unpaid/partial correction; text/group edits with unchanged money.
- [ ] Record screenshots/layout measurements at target widths/themes and keyboard/reduced-motion/zoom behavior. Record physical Safari/Home Screen keyboard/safe-area and production 10-15 second tab-return checks as pending until observed on the user's device.
- [ ] Run antislop Hard/Purpose/Liveliness/Craftsmanship gates with actual implementation evidence; obtain whole-branch review, fix findings and complete the authorized migration-before-frontend release.

## Planning self-review

All pending items map to tasks; existing completed code is classified separately. The five review-focus conditions have named task checks. Financial interfaces are reused from the detailed debt plan. The first task is bounded by a separate brief. Planning inspection does not claim implementation, test success or physical-device acceptance.

## Execution checkpoint (latest, October 8)

The inventory and task checkboxes above reflect the current verified state, not the original planning baseline. Tasks 1, 2, 4a and 4b are reviewed and committed; Task 3 implementation is integrated and locally checked. Task 5.1a money extraction is committed as `ace3917` (98 focused tests/typecheck, Sol low review). Task 5.1b private adapter/storage is committed as `c34d6b4` (9 focused DB checks/typecheck, Sol low review; combined chronological 12 checks passed before the final delta-only adjustment). Scope 5.1c payment integration is in progress; 5.2 correction, Tasks 6-8 and final release checks remain pending. Production runtime/device acceptance is tracked separately from implementation. Landing revamp remains explicitly deferred.
