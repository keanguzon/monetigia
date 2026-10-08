# Task 5.1b handoff

Implemented the private debt settlement boundary in `supabase/migrations/202610080003_debt_settlements.sql`, database types, focused database coverage and the final chronological-state test. The migration remains unreleased. Git ignores `supabase/migrations/*`; root must explicitly force-add this migration when integrating it.

The adapter preserves the exact `{ account, rows }` shape. Historical transaction and opening-item provenance must have one completed operation claim. Purchase rows use the proven transaction result order and group; if grouping or ordinal identity is not proven, the row falls back to its own transaction UUID, ordinal 1, unknown due date and `needs_review`. A historical payment is not reconstructed when earlier account transactions or opening rows have incomplete or ambiguous proof, so later proven obligations cannot receive a guessed allocation.

Positive balance remaining after known rows is treated as undated principal when history is otherwise reconcilable. For the mixed fixture, initial legacy principal 5,000 + purchase 2,000 − payment 400 yields total 6,600, dated remaining 1,600, undated 5,000 and `balanced`; balanced snapshots report delta `0.00`. Review snapshots retain the signed `totalOutstanding - known remaining` delta. Unproven transactions, unsupported income/refund reductions, unmatched payments, unsupported currency and over-recognized schedules remain `needs_review`. The migration does not add current payment quote/apply/delete integration, a public snapshot, correction commands or UI.

Verification on October 8, 2026 used the existing disposable local harness only:

- RED: the four new review regressions failed before the SQL fixes, reproducing the residual, allocation, duplicate-claim and group-fallback defects.
- GREEN: `node C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/debt-settlements.test.mjs` — 9/9 passed after the final SQL change.
- GREEN: the same harness with `tests/database/debt-settlements.test.mjs tests/database/installment-final-state.test.mjs` — 12/12 passed before the final reconciliation-delta formatting adjustment.
- GREEN: `npx tsc --noEmit` — passed after the final SQL and test changes.
- GREEN: `git diff --check` — no whitespace errors.

No production database, production environment file, QA reset/deletion, dependency install, commit or push was used. Newly generated database fixture users were cleaned up by the existing harness. The remaining scope boundary is Task 5.1c: live payment allocation/reversal behavior is not implemented or claimed here. The final chronological database suite was not rerun after the last delta-formatting-only SQL change; the focused settlement suite and typecheck were rerun afterward.
