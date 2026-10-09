# All-users financial reset

The current reset scope is every user in the intended Supabase project. This guide supersedes the selected-owner workflow for that request. No owner UUID is needed. This is a manual maintenance operation, not a migration; never add this SQL to migration discovery.

Prepared and validated on October 9, 2026 in a new disposable local database. Production execution remains pending after landing completion. Production data and the preserved `monetigia_test` database have not been reset. Production administrator access is not available in this workspace.

Use [financial-reset-all-users.sql](financial-reset-all-users.sql). Its final statement is `ROLLBACK`, and the database-name placeholder deliberately prevents an unreviewed run. A database administrator needs BYPASSRLS and table ownership sufficient to alter history triggers. A service-role HTTP client cannot execute this script.

## Scope

| Data | Treatment for all users |
| --- | --- |
| `accounts` | Retain every wallet row, ID, name, type, currency, settings and timestamp. Set only `balance=0`, including credit-card balances. |
| `goals` | Retain every goal row, definition, allocation cadence, styling, status, review choice, completion/archive date and timestamp. Set only `current_amount=0`. |
| `transactions` | Delete all income, expense, transfer, tagged, installment and due history. |
| `financial_operations` | Delete command/result and replay history. |
| `goal_allocation_events` | Delete all reservation, release, spend, move, legacy and reversal events. |
| `debt_settlement_events`, `debt_correction_events` | Delete settlement, payment, reversal and correction history. |
| `debt_due_rows`, `debt_items` | Delete opening/adopted debt schedules and records. |
| `categories`, `budgets`, `user_preferences` | Retain all definitions/settings, including shared categories. |
| `public.users`, `auth.users` | Retain profiles and authentication identity. Other auth tables, sessions, storage and avatars are outside the reset. |
| Schema, functions, migrations, RLS, policies, grants, foreign keys | Preserve. No permanent bypass, schema deletion or wallet deletion is created. |

Empty transactions/allocation events and zero wallet balances make derived goal financial amounts zero. Empty debt history and zero credit-card balances make debt snapshots empty/zero. Goal lifecycle choices remain: a completed goal stays completed, an archived goal stays archived, and a goal awaiting review keeps that decision even though its financial progress becomes zero. Reload the app after a committed reset so browser caches reflect the new server state.

Reviewed inventory comes from the repository migrations through the October 9 transaction metadata migration. The complete four-table debt bundle may be present or absent; a partial bundle aborts. All present reviewed public tables must have the exact reviewed column names. Extra public tables (including foreign tables), materialized financial caches, outside-schema foreign keys into public, unknown public triggers, missing immutable guards, disabled public triggers, inactive internal protection triggers, unvalidated foreign keys and replication sessions abort. New fields or tables need classification and a revised validation before inclusion; their names alone do not establish their scope.

## Operator steps

1. Finish the landing work, then use the intended project's administrative connection for the agreed reset. Check the Supabase project reference and database host outside the script. Many Supabase projects use database name `postgres`, so a matching database name alone cannot prove project identity.
2. Take a full database backup/snapshot and confirm it can restore into a separate project. Export every reviewed table, including all wallet/goal fields, profiles/auth identities, categories, preferences and budgets. Store backups outside Git with restricted access.
3. Compare deployed tables, columns, triggers, foreign keys, functions, policies and RLS with the reviewed migrations. Record trigger definitions and enabled modes. Unknown financial caches or custom triggers require review before proceeding.
4. Pause app writes and background jobs for the maintenance window. Make a reviewed copy of the SQL and replace `REPLACE_WITH_REVIEWED_DATABASE_NAME` once with the checked database name. Keep its final `ROLLBACK` for rehearsal.
5. Run the whole file in one administrative session configured to stop at the first error: `psql -X -v ON_ERROR_STOP=1 -f <reviewed-copy.sql>`, or the complete SQL Editor batch. Do not run fragments. Capture preflight counts, postcheck counts and the result table. A rehearsal still takes maintenance locks and performs transactional deletes before rolling them back.
6. Independently confirm the rehearsal restored rows and protections outside the transaction. After satisfactory rehearsal, change only the final `ROLLBACK;` to `COMMIT;` in the reviewed copy and run the complete file again during the agreed maintenance operation. Keep its captured result with the backup record.
7. After commit, verify all seven financial-history tables are empty (skip the four debt tables only if the whole bundle is absent). Every retained account balance and goal `current_amount` must be zero. Wallet and goal IDs and every other retained field must match the export for every user. Compare profiles/auth, categories, preferences and budgets; check exact trigger definitions/modes, foreign keys, policies and RLS. Read goal/debt snapshots as representative signed-in users, then resume traffic and reload the app.

If any step errors, issue `ROLLBACK` in the same session. If the connection closed, confirm the transaction ended and compare protections before resuming traffic. Preflight/count notices describe the in-transaction state and do not prove a committed reset.

## Transaction and protection behavior

The script locks all reviewed public tables exclusively and `auth.users` in shared mode. It uses a five-second lock timeout and a two-minute statement timeout. All owners' writes wait during the transaction. Existing rows of retained tables are snapshotted for comparison; all financial history is removed without an owner filter.

Only `allocation_history_immutable`, `debt_settlement_immutable` and `debt_correction_immutable` are temporarily disabled. Settlement events are deleted first so the still-enabled payment-delete reversal trigger has no reversals to create. Corrections, due rows and debt items follow, then allocation events, transactions and operation history. Foreign-key triggers remain active in an origin replication session. Deferred constraints are checked before immutable guards are restored, then checked again. Guards return to their exact `O`, `A` or `R` mode; all public trigger definitions/modes must match before/after. A failure or rollback restores both rows and transactional trigger DDL.

The script performs no `TRUNCATE CASCADE`, schema drops, wallet deletes, auth deletes, migration edits or RLS changes. The final rollback and database-name placeholder remain in the repository artifact.

## Disposable validation

[financial-reset-all-users-validation.mjs](financial-reset-all-users-validation.mjs) creates a randomly named database on loopback PostgreSQL, applies migrations once, seeds two owners and drops only the database it created. Its admin connection must target `postgres` and cannot contain URL query parameters that could override the checked host. It never connects to `monetigia_test`; bootstrap cluster-role creation/grants are stripped so existing cluster roles are untouched.

```powershell
$env:RESET_TEST_ADMIN_URL = 'postgresql://postgres@127.0.0.1:55439/postgres'
$env:RESET_TEST_PG_MODULE = 'C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/node_modules/pg/lib/index.js'
$env:RESET_TEST_BOOTSTRAP = 'C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/bootstrap.sql'
node docs/codex-review/pending-rollout/financial-reset-all-users-validation.mjs
```

Passed: wrong/default database confirmation, unreviewed table/materialized cache/column/dependency, disabled guard, non-admin and replication-session aborts; full dry-run rollback, interrupted guard rollback, forced-failure rollback, all-users commit and replay, plus a rehearsal of the whole debt-absent branch; preservation of definitions/auth/functions/constraints/policies/RLS/guard modes, active foreign-key triggers and zero derived goal snapshots. Both owners then successfully recorded authenticated income of 1,000, a credit purchase of 100 and a payment of 100: each cash wallet ended at 900, credit balance at zero, and debt reconciliation balanced. Fresh disposable fixtures also proved immutable guards enforce deletes after restoration. Debt-absent rehearsal temporarily removes the debt bundle and its payment trigger and restores the baseline identity guard inside a transaction in the disposable database; rollback restores that fixture schema.

Synthetic debt fixture INSERT validators are bypassed only during fixture construction in the disposable database and restored before reset testing. Foreign keys stay active. These tests establish reset behavior against the migrated local schema; the operator must still compare the deployed schema before production execution.
