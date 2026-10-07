# Existing Debt and Installment Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Import remaining debt with real due dates, reconcile outstanding totals and support safe selected-installment corrections.

**Architecture:** Keep existing actual-money transactions and account balance effects authoritative. Introduce opening-debt items and due rows without fake expense transactions; attach existing purchase installment rows to the same schedule read model. Use authenticated, idempotent atomic commands for account creation, payment allocation and bulk correction.

**Tech Stack:** Next.js 14, React, Tailwind, SWR, Supabase/PostgreSQL, Zod, Vitest and native database tests.

**Spec:** docs/superpowers/specs/2026-10-07-existing-debt-selection-design.md

## Global constraints

- Planning complete does not mean implementation complete. Current initial-debt summary bug remains open.
- Work in the existing feature worktree or a suitable isolated codex branch; preserve disposable QA data. No database reset merely to get clean examples.
- Antislop during (session override); Goals typography/surfaces, shared primary green; ENERGY 1 / RHYTHM 2 / MOTION 1. Fixed footer, 44px controls, readable light/dark, keyboard and reduced motion.
- Luna max for coding, medium/high for bounded checks. Sol low/medium for complex financial review/implementation. No new Astra or Sol high. Per-task specification and quality review.
- Positive integer count typed as digits; use inputMode numeric, not HTML number acceptance of e/+/-. Validate UI, Zod and SQL. Implementation safety ceiling 600 months, clearly reported; 24 is supported, not a maximum.
- Monetary values are decimal text externally and exact centavos internally. Last row absorbs remainder; reject totals too small to give every row a positive centavo.
- New single/first due dates required. Allow overdue existing debt; never assign invented purchase dates to imported debt.
- Existing normal purchase date must not be later than first due date; prevent the invalid sequence exposed by earlier QA instructions.
- Recorded payments and cash wallets survive debt correction. Keep single delete behavior for unrelated income/expense transactions.
- Existing request replay, owner checks, write guards, goal reversal rules and cache refresh mechanisms remain in force.
- Push/integration authorization applies to the current completed implementation; future product changes require the user's execution instruction.

## Current source evidence

- AddAccountModal.tsx and AddAccountForm.tsx directly insert account balance; neither captures opening-debt schedule.
- accounts/page.tsx calculates month debt solely from transaction history, limited to 5,000 rows. The fixture's initial 5,000 is omitted: tile 6,600 versus All months 1,600 after payment.
- contracts.ts MAX_INSTALLMENTS is currently 12; frontend date helper and SQL caps must change together.
- InstallmentHistoryGroup.tsx owns disclosure/row actions. history.ts owns group formation/sorting.
- goal_finance_apply is the owner-serialized, idempotent financial dispatcher; never implement bulk deletion as client-side individual RPC loops.
- Database test harness can reinstall older SQL. Final verification must apply the entire migration sequence and test the resulting installed dispatcher.

## File map and interfaces

Create:
- src/lib/debt/contracts.ts: OpeningDebtDraft, DebtSnapshot, correction schemas.
- src/lib/debt/schedule.ts: strict count parser and exact schedule generation.
- src/hooks/use-debt.ts: authenticated snapshot/command integration and cache refresh.
- src/components/accounts/ExistingDebtFields.tsx: mode/items/count/date inputs and preview.
- src/components/transactions/InstallmentSelection.tsx: selection state and accessible controls.
- supabase/migrations/202610070002_existing_debt_schedules.sql: tables, read RPC and atomic commands; choose the next unused migration filename at execution.
- tests/debt-schedule.test.ts, tests/existing-debt.test.tsx, tests/debt-selection.test.tsx, tests/database/existing-debt.test.mjs, tests/database/debt-corrections.test.mjs.

Modify:
- src/components/accounts/AddAccountModal.tsx and src/components/forms/AddAccountForm.tsx: both account creation entry points.
- src/components/accounts/DebtScheduleSection.tsx and src/app/(dashboard)/accounts/page.tsx: shared complete debt read model.
- src/components/transactions/InstallmentHistoryGroup.tsx, AddTransactionModal.tsx, src/lib/transactions/history.ts, src/app/(dashboard)/transactions/page.tsx.
- src/lib/goals/contracts.ts, src/lib/transactions/installment-dates.ts, src/types/database.ts: contract/schema parity.
- tests/database/helpers.mjs and relevant existing history/contribution tests: migration installation and regressions.

Interfaces:
- OpeningDebtDraft = { clientId: string; name: string; mode: 'single'|'installments'; amount: Money; firstDueDate: string; count: number } (single count=1).
- parseRemainingMonths(value: string): number | null; only /^[0-9]+$/ with safe integer 1..600.
- buildDebtSchedule(amount: Money, firstDueDate: string, count: number): Array<{ ordinal:number; dueDate:string; amount:Money }>.
- debt_account_create(requestId:uuid, account:jsonb, openingDebts:jsonb): { accountId:uuid; debtItemIds:uuid[]; replayed:boolean }.
- debt_snapshot(): { accounts:Array<{ accountId:uuid; totalOutstanding:Money; undatedOutstanding:Money }>; rows:DebtDueRow[] }.
- DebtDueRow = { id:uuid; accountId:uuid; groupId:uuid; source:'opening'|'purchase'; transactionId:uuid|null; dueDate:string|null; originalAmount:Money; paidAmount:Money; remainingAmount:Money }.
- Financial command additions: {kind:'correct_debt_rows'; accountId:uuid; rowIds:uuid[]; fingerprint:string} and {kind:'adopt_opening_debt'; accountId:uuid; items:OpeningDebtDraft[]; fingerprint:string}.
- Payment transfers retain their current command interface; dispatcher allocates debt settlement events atomically and returns existing FinancialResult. useDebt exposes snapshot/error/loading/refresh and uses the established request-ID recovery lane.

## Review focus

1. Network timeout/replay after creating several debts: one wallet and one set of obligations (Task 2).
2. Two tabs pay or delete the same selected rows: stale correction rejects atomically, no cash refund or partial deletion (Tasks 3/5).
3. Legacy opening balance with no dated transaction and incomplete history: total stays truthful, no invented dates or 5,000-row truncation (Task 4).
4. Payment reversal after correction: restore original settlement amount and preserve previously corrected principal (Task 3).
5. Selection across reorder/collapse/load-more and text input: no stale index deletion, no hijacked browser shortcuts (Task 7).

### Task 1: Exact schedule and shared validation

**Files:** debt/contracts.ts, debt/schedule.ts, goals/contracts.ts, transactions/installment-dates.ts; tests/debt-schedule.test.ts.

- [ ] Write failing assertions: parseRemainingMonths('24')=24; '2'=2; '2.5','2e1','-2','+2','abc','0','601' return null. PHP 1,000 over 3 => 333.33/333.33/333.34; 24-month sums exact; Jan31 => Feb28/29 => Mar31; total smaller than count centavos rejects.
- [ ] Run npx vitest run tests/debt-schedule.test.ts; verify failures for missing behavior.
- [ ] Implement specified functions and shared 600 cap; validate purchase/first-due ordering for new purchases while imported opening schedules have no purchase-date fiction.
- [ ] Run focused tests plus existing installment tests and typecheck; review contract parity; commit.

### Task 2: Atomic opening-debt creation and secured schema

**Files:** new migration, database types, debt contracts, tests/database/existing-debt.test.mjs, helpers.mjs.

**Produces:** debt_account_create, debt_snapshot and owner-scoped opening debt/due/settlement/correction tables.

- [ ] Add failing DB tests: two debts 16,000 + 3,000 create account debt 19,000 exactly once; no expense/cash/goal changes; replay same UUID unchanged; different payload same UUID conflicts; one invalid item rolls back account and every row; other-user writes reject.
- [ ] Run focused native DB test and confirm expected failures.
- [ ] Implement authenticated RPC with owner-first lock ordering, decimal validation and date/count parity. Opening rows are obligations, not transactions; guard direct writes, enforce FKs/RLS and fixed search_path.
- [ ] Implement snapshot with all owner-scoped rows and authoritative nonnegative credit debt totals. Paid/corrected rows retain audit records.
- [ ] Verify rollback/security/replay tests against final installed migrations; independent financial review; commit.

### Task 3: Payment allocation and reversible settlements

**Files:** migration financial dispatcher extension, use-debt.ts; tests/database/existing-debt.test.mjs and financial-transactions.test.mjs.

**Consumes:** DebtDueRow; existing transfer/deletion commands. Payment selection remains unchanged.

- [ ] Add failing tests: oldest due obligations settled first, stable tie-break by due/item/ordinal/id; 400 payment changes cash 10,000->9,600 and debt 7,000->6,600 once; schedule remaining reduces 400; payment deletion restores both amounts and original settlement allocations.
- [ ] Cover partial payment, legacy undated residual, overpayment existing semantics and reversal after unpaid correction; do not make schedule allocation a second cash effect.
- [ ] Implement settlement events in the same transfer/deletion transaction. Allocate known oldest due first, then legacy undated residual; preserve all actual payment records.
- [ ] Run focused DB tests and goal/debt reversal regressions; review lock/idempotency behavior; commit.

### Task 4: Reconciled outstanding totals and legacy adoption

**Files:** accounts/page.tsx, DebtScheduleSection.tsx, use-debt.ts, migration adoption command; tests/existing-debt.test.tsx and database/existing-debt.test.mjs.

- [ ] Add failing fixture assertion: opening 5,000 + purchases 2,000 - payments 400 => Total outstanding 6,600, not 1,600; All months deduction includes full outstanding. Selected dated months use separately labeled Scheduled debt.
- [ ] Cover >5,000 history rows, refunds/corrections, zero-debt accounts and cross-owner isolation; no frontend truncation changes authoritative totals.
- [ ] Backfill known purchase due rows from authoritative installment IDs. Calculate legacy unallocated debt under lock from current balances minus recognized remaining obligations; discrepancies require review, never silently rewrite balances.
- [ ] Provide legacy Needs due-date review action; confirmed opening schedules distribute existing residual without increasing account balance. Reject stale fingerprint or mismatched total.
- [ ] Replace duplicate month arithmetic with shared snapshot. Distinguish total debt, selected-month schedule and undated review residual; preview deductions use the matching labeled amount.
- [ ] Run focused UI/DB tests; root verifies 6,600 fixture and partial-month labels; review; commit.

### Task 5: Atomic selected unpaid-debt correction

**Files:** financial command contracts, migration dispatcher, tests/database/debt-corrections.test.mjs.

**Produces:** correct_debt_rows using accountId, stable row IDs and reviewed snapshot fingerprint.

- [ ] Add failing tests: select two 400 unpaid rows => debt -800, cash/reservations unchanged; payment history survives; paid rows reject; partially paid 400 row with 100 paid => correction removes only remaining 300.
- [ ] Test mixed-owner/mixed-account IDs, duplicate IDs, empty selection, already-corrected rows, stale concurrent payment and replay. Reject invalid entire batch without partial work.
- [ ] Implement one atomic correction command with audit events. Opening rows correct principal without transactions; purchase rows reuse existing authoritative deletion/reversal invariants for unpaid parts and preserve settled transaction linkage rather than deleting payment records.
- [ ] Require selection within one expanded group. Revalidate unpaid amounts under lock against confirmation fingerprint; update balance once and return result.
- [ ] Run focused tests plus active/completed goal reversal tests; independent financial review; commit.

### Task 6: Add Wallet opening-debt UI and fixed footer

**Files:** AddAccountModal.tsx, AddAccountForm.tsx, ExistingDebtFields.tsx, use-debt.ts; tests/existing-debt.test.tsx.

- [ ] Add failing UI tests: None default; Single requires due; installments requires strict integer count/date; 24 accepted; 2 accepted; decimal/paste/exponent rejected; multiple debts sum accurately; failed save preserves draft; timeout same-request recovery avoids duplicate wallet.
- [ ] Run tests and confirm missing behavior fails.
- [ ] Implement named debt items and Add another existing debt; amount means remaining debt. Summary preview first 3 rows + View full schedule, rendering on demand; no past payments/original purchase required.
- [ ] Credit account uses atomic creation RPC; normal wallet creation remains unchanged. Both modal and standalone entry points share validation; server errors do not show success.
- [ ] Modal flex bounded height, fixed header/footer, native form submit, scrollable middle with all feedback, Escape/Cancel, reset on opening and safe-area padding.
- [ ] Run tests/typecheck; root browser at 375/768/1280 both themes; review; commit.

### Task 7: Accessible selection, full-row state and confirmation

**Files:** InstallmentSelection.tsx, InstallmentHistoryGroup.tsx, history.ts, transactions/page.tsx; tests/debt-selection.test.tsx.

- [ ] Add failing tests: Select activates checkbox mode; Select all targets current group's eligible unpaid rows; deselect all clears; Shift-click selects stable visible range; Tab/Space works; rows reorder without incorrect selection.
- [ ] Cover collapse/sort/filter/account change clears selection, refresh removes deleted/paid IDs, collapsed content inert, Delete selected disabled when none, no global Ctrl+A/Delete handling.
- [ ] Implement whole-row hover/focus/selected surface through amount/actions. No bounce, no drag. Parent group toggle must not intercept checkbox/delete interactions.
- [ ] Confirmation shows debt name, selected count and exact remaining total; e.g. 2 installments / PHP 800. Explicitly state recorded payments/cash are unchanged. Cancel/Escape save nothing; pending prevents duplicates; stale refresh requires re-review.
- [ ] Opening debt appears as Existing debt with due dates, not as a fabricated expense/purchase. Preserve Date added/Transaction date behavior for actual purchases and truthful legacy unknown dates.
- [ ] Run tests and root keyboard/mobile checks; review; commit.

### Task 8: Edit transaction title/description safely

**Files:** TransactionDetailModal.tsx, InstallmentHistoryGroup.tsx, history.ts, transactions/page.tsx, debt/contracts.ts, financial dispatcher migration; tests/transaction-history.test.tsx and tests/database/transaction-description.test.mjs.

**Interface:** authenticated command { kind:'edit_transaction_description'; transactionId:uuid|null; groupId:uuid|null; description:string|null; expectedDescription:string|null }, exactly one target; use existing request UUID/replay lane. A legacy installment group resolves by authoritative operation IDs, never by matching description text.

- [ ] Add failing DB assertions: editing ordinary description changes only text; account balances, goal allocations, transaction dates/amount/category and payment history remain identical. Group edit changes owned siblings consistently and preserves installment suffix/ordinals. Owner mismatch rejects; stale expected description rejects; identical UUID replays once.
- [ ] Add failing UI tests: Edit in transaction detail and group action, accessible input, Save/Cancel, Escape without change, error preserves input, success updates title/search immediately. Empty text maps to null and existing category fallback. Limit description to 500 characters in both UI and SQL; reject overlength rather than truncate.
- [ ] Implement a dedicated authenticated metadata command using the existing guarded write lane; do not bypass transaction write protections with direct client updates. Preserve purchase metadata and original financial operation history.
- [ ] Refresh affected history/detail caches on success. Unknown response retries the same UUID; prevent a second simultaneous save. A delete during editing returns a visible stale/missing error without resurrecting data.
- [ ] Run focused UI/DB tests and unchanged-balance regressions; spec/quality review; commit.

### Task 9: Integrated verification, migration guide and handoff

**Files:** docs/codex-review/EXISTING_DEBT_VERIFICATION.md; update portable handoff and this plan.

- [ ] Run npx tsc --noEmit, npm test, npm run test:db, npm run lint, npm run build sequentially; log exit codes. Restore/apply full newest migrations then run final-installed-state tests; never claim results from an older dispatcher.
- [ ] Use isolated build output to protect active preview. Document exact tests/warnings and fresh result counts; don't copy old counts as new results.
- [ ] Root manual QA: single/multiple opening debts; 24 months; due-month filter; 6,600 reconciliation; reserve/spend untouched; payment/reversal; selected partial correction; concurrent stale quote; failed/cancelled writes; unknown-response replay.
- [ ] Check 375/768/1280, light/dark, touch/keyboard, full-row states, safe-area/footer, long schedules, reduced motion. Physical iOS checks recorded separately.
- [ ] Complete antislop Hard/Purpose/Liveliness/Craftsmanship gate with root evidence and whole-branch spec/quality review. Commit reviewed changes; request integration only under then-current authorization.

## Self-review and execution boundary

All agreed requirements map to Tasks 1–8; all five review-focus conditions have named tests. Types/interfaces are shared above. Backend tasks precede UI; no bulk operation uses loops of separate client writes. Legacy debt review preserves balances without invented dates. Payment accounting and correction are intentionally separate.

This plan is saved for later execution. The current request builds and pushes the already implemented branch to beta; it does not implement this new plan. Resume manual QA after that integration. The confirmed opening-debt bug remains an explicitly known beta issue until these tasks run.
