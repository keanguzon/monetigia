# Task 8 implementation report

## Scope and implementation

- Replaced every transaction insert/account balance update sequence in AddTransactionModal with quoteTransaction and applyAndRefreshFinancialCommand, including installments. Existing Expense defaults, defaultAccountId callers, the empty amount/wallet Spend shortcut, debt previews and installment dates remain supported. The removed standalone form was not restored.
- Added useTransactionSubmit with editing, quoting, review, saving and saved phases. Release proposals require an explicit click on Release funds and save. Zero-release initial quotes can save directly; a stale quote always returns to review for another confirmation. Form edits and dialog closure invalidate pending quotes, and late responses cannot restore them.
- A user-scoped controller retains an unresolved confirmed request, command and quote across reset, dialog closure, unmount and reopen. Synchronous guards prevent duplicate writes. Unknown retries retain the same UUID; definite database rejection permits correction with a new UUID. Live session checks block an old user's command without discarding an already unresolved request.
- Added custom per-goal release amounts, shortfall validation and server re-quotation before confirmation. Insufficient money and command errors display human guidance/HINT text without raw SQL error messages.
- Income excludes goal tags. Cash transfer goal selection means an explicitly entered reservationMoves amount to carry; credit payment selection lists debt goals and consumes their reservation. Credit purchases and installments retain an informational goal association and state that they do not fund or spend from the goal.
- Wallet choices require active PHP accounts. Normal cash choices are generic non-credit wallets, including GoTyme; userPayLater remains a credit purchase/payment account and cannot back a reservation.
- Added a user-scoped deletion controller using delete_transaction with an idempotency UUID. Unknown deletions survive page unmount and block a replacement deletion until recovered. Both local transaction data and shared financial caches refresh, even when one refresh fails. A committed deletion/transaction remains saved and cannot be submitted again following a refresh failure.
- Transaction details use owned goal history and the complete finance snapshot, retaining archived goal names. Spending, carried reservations and unrelated automatic releases have distinct labels. The history adapter now exposes an optional linkedTransactionIds list, validated as UUIDs from the owned operation result, so null-transaction-id automatic releases remain associated with their real operation without inventing an event transaction ID.
- Detail/deletion dialogs now use Radix for focus containment and keyboard dismissal. New confirmation/retry/cancel controls have 44px minimum heights; the detail and entry panels scroll within 90dvh. The entry form keeps the existing theme/layout and reduced-motion transfer state.

## Controller-approved narrow SQL corrections

The original Task 4 SQL rejected all credit-expense goal tags, contrary to the approved informational-purchase behavior. The controller explicitly expanded Task 8 to correct this gap in migration 004 and the schema bundle.

- Quote validates ownership, active/confirmed goal state for a tagged credit expense, but does not require or consume a cash reservation. Credit income and transfer tags remain invalid.
- Apply keeps the tag on the real purchase/installment rows, books total debt once, and skips goal allocation events for credit expenses.
- Native database tests cover single and installment tagged purchases with zero reservations, unchanged progress, replay, deletion of a selected installment, foreign goal rejection and rejected income/transfer tags.

Reapplication exposed another previously existing gap: migration 005 retained an older private transaction helper after migration 004 was reapplied. The controller explicitly authorized the minimal 005/schema-bundle correction.

- Resolve the exact public signature goal_finance_apply(uuid,jsonb,jsonb).
- Identify the 004 implementation by its positive goal_normalize_transaction marker and absence of delegation to goal_transaction_apply. Identify the 005 dispatcher by the inverse checks; reject ambiguous/missing definitions.
- For an existing helper, transfer pg_get_functiondef only when the public function is the 004 implementation. Replace exactly the canonical function header, preserving its body, defaults, SECURITY DEFINER and search path.
- Standalone 005 reapplication leaves the private helper intact. Fresh rename requires the 004 implementation. The existing private-lane grant revocation still runs.
- A behavior regression reapplies 004, 005 and standalone 005, then saves a tagged credit purchase, verifies zero allocations/progress, exercises lifecycle close, and checks denied direct helper grants.

## TDD evidence

1. `npx vitest run tests/transaction-release.test.tsx`
   - Initial missing-hook import demonstrated the missing feature but did not count as the behavioral RED run.
   - With a no-op interface scaffold, the behavioral RED run reported **9 failed / 2 passed**. Expected examples: phase remained editing instead of review/saved; no quote/apply calls; no Release funds and save button.
   - GREEN after controller/modal integration: **11/11 passed**.
2. Focused additions caught missing type-change invalidation and deletion API (**3 failed / 11 passed**), then passed **14/14** after integration.
3. Detail/history linkage RED: `npx vitest run tests/transaction-release.test.tsx tests/goal-actions.test.tsx` reported **2 failed / 36 passed**, with missing spend/carry/release detail and missing linkedTransactionIds. GREEN: **38/38**.
4. Delayed zero-release quote RED reported **2 failed / 17 passed**: unmount and auth switch still wrote. Guards then passed **19/19**.
5. Live session mismatch/active-wallet RED reported **3 failed / 23 passed**: unresolved request was discarded on session mismatch, and null-active wallet remained selectable. GREEN after preserving requests and strict wallet eligibility: release **26/26** plus contributions **8/8**.
6. `node .superpowers/local-db/run-test.mjs tests/database/financial-transactions.test.mjs`
   - Credit goal-tag RED: **11 passed / 2 failed**, both with INVALID_STATE on the required informational tag.
   - Credit correction GREEN: **13/13 passed**.
   - Reapplication RED: helper used the old spend behavior, producing **1 allocation instead of 0**. The same run also exposed a test's unordered wallet assumption, corrected to find the wallet by ID.
   - Reapplication correction GREEN: **14/14 passed**.

## Final verification

- `npm test`: **2/2 Node tests and 111/111 Vitest tests in 7 files passed**, exit 0. No test warnings/errors.
- `npx tsc --noEmit`: **exit 0**, no diagnostics.
- `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs tests/database/goal-lifecycle.test.mjs tests/database/ledger.test.mjs tests/database/reservations.test.mjs`: **57/57 passed**, exit 0, zero skipped/cancelled.
- `node .superpowers/local-db/restore-task-8.mjs`: reapplied the actual 004 and 005 migration files after the older reservation suite reset the dispatcher. Verified the public function delegates to the transaction helper, the private helper uses cash-only goal spending, both retain SECURITY DEFINER and `search_path=pg_catalog, public`, and authenticated direct helper execution is false. No manual helper-body patch was used.
- `git diff --check`: exit 0. Git emitted only the workspace's existing LF-to-CRLF conversion notices.
- Read-only source search found no transaction insert/account update sequence or delete_transaction_atomic call in transaction UI. Existing Accounts fetch-time balance update is the separate Task 9 scope.

## Antislop and accessibility evidence

Direction comes from the binding brief: existing Manrope/Bricolage, restrained emerald, ENERGY 1 / RHYTHM 2 / MOTION 1. The release notice exists to explain the exact goals/amounts affected; its separated summary and confirmation actions provide the hierarchy. No visual assets, decorative sections or fictional claims were added.

- PASS, functional states: real UI tests exercise review, decline, custom inputs, confirm, edit, unknown retry, saved feedback, loading invalidation and human errors. Controls have actual handlers and duplicate guards.
- PASS, command safety: explicit pre-confirmation zero-write assertion, post-confirmation one-write assertion, same request identity across unknown retry, fresh stale confirmation and saved/no-resubmit assertions.
- PASS, scoped theme text contrast: contrast-check.py reports white on emerald-700 **5.48:1**, emerald-400 on slate-950 **10.49:1**, red-700 on white **6.47:1**, and red-300 on slate-950 **10.63:1** for the added action/error colors. Existing global theme tokens were not changed.
- PASS, keyboard structure: Radix dialogs preserve keyboard focus containment/dismissal; retained Escape cancellation coverage passes. New entry/detail close and release/deletion/retry targets have minimum 44px hit areas and focus rings.
- PASS, local source resilience review: modal widths are fluid with narrow-screen margins; custom controls stack on phones and confirmation actions can reflow; scroll height uses dvh; no new fixed desktop-width content or image dependency.
- Scope limit: actual 375/768/1280 viewport, light/dark browser click-through and reduced-motion visual acceptance belong to Task 11 and were not claimed here. No build or live/cloud database write was run.

## Files changed

- src/hooks/use-transaction-submit.ts (new)
- src/components/transactions/GoalReleaseNotice.tsx (new)
- src/components/transactions/AddTransactionModal.tsx
- src/components/transactions/TransactionDetailModal.tsx
- src/components/goals/GoalSelector.tsx
- src/app/(dashboard)/transactions/page.tsx
- src/lib/goals/client.ts
- supabase/migrations/202610060004_goal_transaction_operations.sql
- supabase/migrations/202610060005_goal_lifecycle_operations.sql
- supabase/schema.sql
- tests/transaction-release.test.tsx (new)
- tests/contributions.test.tsx
- tests/goal-actions.test.tsx
- tests/database/financial-transactions.test.mjs
- .superpowers/sdd/2026-10-06-goal-reservations/task-8-report.md

The disposable restore script is ignored local harness material. Controller progress/local-preview reports remain unstaged and were not edited by this implementer.

## Self-review and remaining scope

- Reviewed command identity, late quote/user switching, release confirmation, error guidance, SQL atomic/debt behavior, helper grants and source diff. All required checks pass.
- No new runtime dependencies, cloud action, push, merge or deployment.
- Manual browser acceptance remains Task 11; legacy review remains Task 10. No known blocking concern for Task 8 handoff.
