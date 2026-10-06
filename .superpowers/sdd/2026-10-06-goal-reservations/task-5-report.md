# Task 5 implementation report

Implemented lifecycle commands and transaction deletion in the public finance dispatcher. The repeatable migration keeps the existing transaction/reservation lanes as private helpers, with direct execution revoked for every client role. New mutations require `auth.uid()` ownership, lock the profile first and goals/accounts in UUID order, and complete operation results atomically with status, allocations, balances, and deletion.

Closing below target succeeds. Nonzero leftovers require a release or destination choice; moves preserve each backing wallet. Completion/cancellation preserve spending and mirror the legacy completion boolean. Reopen produces no reservations; archive requires a closed goal with zero reservations. Reads never update the legacy boolean.

Deletion reverses the selected transaction amount, including only the selected scheduled installment row. This preserves the current single-UUID caller behavior, confirmed by the controller; other installment rows and their remaining booked debt stay intact. Original allocation values/IDs and transaction UUID references remain unchanged. Active spending/release/carrying events receive nonzero audited reversals linked through `reversal_of`; spent-only imported events reduce spending without inventing reservations. Closed/archived goals receive no reservation restoration and remain closed. Closed release/carry reversals with no allocation effect emit no zero-value event: the deletion operation command/result audits the transaction UUID, as directed by the controller, preserving the ledger's existing zero-event constraint.

Transfer reversal validates actual balances, carried reservations, and resulting wallet backing. Income reversal cannot reduce actual below reservations. Failures include corrective guidance in SQL `HINT`; Task 6's client should expose that guidance or an equivalent mapped instruction. Auto-release originals from migration 004 are located through their owning transaction operation result because those release events have no transaction UUID.

## TDD and verification

- RED: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/goal-lifecycle.test.mjs` before production edits: **0 passing, 14 failing**. Lifecycle/deletion requests returned the existing `INVALID_STATE`, including expected `INSUFFICIENT_ACTUAL`, `INSUFFICIENT_AVAILABLE`, and ownership assertions receiving that unsupported-command failure. This verified the missing operation lane. Tests exercised real Supabase SDK/PostgREST against disposable PostgreSQL 16 on loopback ports 55439/55440/55441.
- GREEN: same focused command after migration: **14 passing, 0 failing**. Added focused coverage for downstream reservation loss with actual money intact, closed carrying reversal, debt payment reversal, injected late deletion failure, private helper denial, read-only legacy boolean, and concurrent duplicate lifecycle requests. Re-ran the focused command: **19 passing, 0 failing**, output clean.
- Full suite: loaded `.superpowers/local-db/environment.json` into process environment only, then `npm run test:db`: **55 passing, 0 failing**, output clean. No live `.env` values used or printed.
- TypeScript: `npx tsc --noEmit`: exit **0**, no output.
- Restored the complete ordered schema after the suite (earlier test files intentionally reinstall earlier dispatchers): read `supabase/schema.sql` and applied it via the disposable adapter's `queryAdmin`: `Ordered schema restored`.
- Post-restore SQL inventory: PostgreSQL **16.15**; authenticated public apply execution **true**, private transaction and reservation execution **false**. An initial inline SQL inventory command had a shell quoting syntax error before any query ran; corrected with a literal here-string and obtained the above result.
- `git diff --check`: no whitespace errors. Git emits only its configured LF-to-CRLF working-copy notices.

Rollback tests compare all owner goals, accounts, operations, events, and transactions. The injected `BEFORE DELETE` failure occurs after reversal inserts and balance updates, proving those writes and the operation result roll back together. The closed expense test pins status `completed`, reserved `0.00`, spent `0.00`, unchanged completion/archive timestamps, and available refund. Other coverage verifies wallet breakdown during leftover moves, repeated deletion replay without appended reversals, non-restoration of closed releases, and 1000.01 debt installments leaving exactly 666.67 debt and two rows after deleting the first 333.34 row.

## Files and self-review

- `supabase/migrations/202610060005_goal_lifecycle_operations.sql`
- `tests/database/goal-lifecycle.test.mjs`
- `supabase/schema.sql`: ordered migration bundle only
- `.gitignore`: one narrow migration exception
- This report

Reviewed validation/ownership, private grants, profile-first lock ordering, decimal arithmetic, idempotency, event provenance, transaction retention, closed-state handling, full rollback, migration reapplication, and bundle consistency. No changes to Task 6+ UI/adapter or permission cutover. Controller-owned `progress.md` remains unstaged.

No correctness concern remains from self-review. Integration considerations: the new caller transport/UI belongs to later tasks; legacy live deletion-RPC inventory remains deployment preflight because its definition is absent locally. No build, live migration, push, merge, or deployment was performed.
