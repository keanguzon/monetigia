# Task 5.1c handoff

Implemented live debt payment allocation in the existing unreleased migration, `supabase/migrations/202610080003_debt_settlements.sql`. The migration patches the newest quote and apply definitions in place, with explicit source-match checks and repeat-install guards. The quote replaces the monthly transaction ceiling with `debt_account_state(...).account.totalOutstanding` and fingerprints the full debt state. The apply path preserves the existing cash, debt balance, goal reservation, replay and dispatch behavior; it locks known settlement targets, allocates by the adapter's due-date/group/ordinal/UUID order, then records any remainder against undated residual. Entered payment dates remain unchanged.

Settlement events are emitted only when the account is reconciled before payment. A payment against incomplete or unsupported history still follows the existing actual-money path, while the adapter keeps the account in `needs_review` without guessing a row allocation. Payment deletion appends a reversal for each original event with the same target and amount; the event identity constraints and existing financial operation replay make reversal single-use. Credit-source advances remain undated, and refund-like income is never labeled a cash payment.

The focused tests cover opening-only debt, mixed legacy residual and purchases, FIFO and equal-date ordering, partial allocation, overpayment rollback, concurrent identical replay and changed-request conflict, payment deletion and replayed reversal, cash and reservation gates, and unsupported-history review behavior. The review note's UUID-dependent FIFO expectation was changed to derive the first allocation from the sorted row, and the focused suite now passes.

Verification used the existing explicitly disposable local harness. Before the integration, the focused debt and financial transaction tests reported 24 passing and 4 failing; opening-only payments were rejected by the former monthly ceiling. Final sequential results:

- `tests/database/debt-settlements.test.mjs`: 13/13 passed.
- `tests/database/financial-transactions.test.mjs`: 15/15 passed.
- `tests/database/goal-lifecycle.test.mjs`: 19/19 passed.
- `tests/database/installment-final-state.test.mjs`: 3/3 passed.
- `npx tsc --noEmit`: passed with no diagnostics.
- `git diff --check`: passed.

The migration remains unreleased and ignored by Git, as documented for 5.1b. No production database, production environment, QA reset/deletion, dependency install, commit or push was used. Fixture cleanup ran through the harness. The payment/correction references and unsupported-source cases remain subject to the established `needs_review` behavior; the separately scoped 5.2 explicit purchase-deletion guard and 6a public snapshot are not part of this handoff. No production-readiness claim is made.

