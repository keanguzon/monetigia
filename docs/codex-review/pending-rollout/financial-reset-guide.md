# Selected-owner financial reset

Status: prepared and independently validated on a newly created disposable database on October 9, 2026. Production execution is deferred until the landing page is complete. This replaces the planned legacy reconciliation for this owner. It is not a schema migration and must never be added to automatic migration discovery.

Validation passed: default rollback, rollback with temporarily disabled guards, forced failure rollback, committed owner-only reset, repeat reset, preservation of other users and definitions, exact trigger modes, functions, policies, RLS and foreign keys. Authenticated post-reset income of 1,000, credit purchase of 100 and payment of 100 also passed: cash 900, credit debt zero and balanced debt snapshot. No production or preserved QA database was reset.

The editable script is [financial-reset-owner.sql](financial-reset-owner.sql). Its final statement is `ROLLBACK`. It requires a database administrator with BYPASSRLS and table ownership sufficient to alter the three immutable-history triggers. A service-role HTTP client alone cannot run this script.

## Reset scope

Every delete or balance update names the single UUID in `reset_owner`. The owner must exist in both `auth.users` and `public.users`. No other owner is selected. The script retains foreign-key enforcement and validates deferred constraints before finishing.

| Table | Selected owner's treatment |
| --- | --- |
| `accounts` | Retain every row and ID; set `balance=0`, including credit-card debt balances. Retain names, types, currency, colors, icons, active/savings flags, interest rates, net-worth inclusion, display order and timestamps. |
| `goals` | Retain every row and definition; set only cached `current_amount=0`. Retain names, target amounts/dates, allocation cadence/amount, priority/category, styling, lifecycle/status, review decisions and timestamps. |
| `transactions` | Delete all types, tagged transactions, transfers, installment purchases and due entries. |
| `financial_operations` | Delete operation/replay history, including command/result JSON for financial commands. |
| `goal_allocation_events` | Delete reservation, release, spending, move, legacy and reversal history. |
| `debt_settlement_events` | Delete payments/settlement and reversal history first. |
| `debt_correction_events` | Delete correction history. |
| `debt_due_rows` | Delete opening-debt due schedules. |
| `debt_items` | Delete opening/adopted debt records. |
| `budgets` | Retain budget definitions and dates. There is no cached spending column in the reviewed schema. |
| `categories` | Retain owner and global category definitions. |
| `user_preferences` | Retain preferences. |
| `public.users`, `auth.users` | Retain profiles and authentication identity. Other auth tables, sessions, storage and avatars are outside this reset. |

Reviewed sources are the October 6 baseline/goal migrations, October 7 installment migration, [production-debt-one-shot.sql](production-debt-one-shot.sql) (the October 8 debt rollout), and October 9 transaction metadata migration. The reset supports either all four debt tables or none; a partial debt deployment aborts. There is no checkpoint table in those sources as of preparation. Extra public tables, extra wallet/goal columns, unknown public triggers, missing immutable guards or already-disabled public triggers abort before writes. An extra table is unreviewed, not automatically classified as financial. Inspect its owner keys, foreign keys, data meaning, RLS and trigger behavior, then update this inventory and validation before adding any explicit treatment. Do not guess a checkpoint table's scope from its name.

`goal_finance_snapshot()` derives reserved/spent/progress and wallet availability from accounts and allocation events. Empty events and zero balances make those amounts zero; empty transactions also remove legacy tagged totals. Debt snapshot/selection derives schedules and unpaid balances from debt rows, transactions, events and account balances, so those become empty/zero. The reset does not invent replacement financial operations.

Completed goals remain completed with their completion dates, cancelled goals remain cancelled, and archived goals remain archived. A goal marked `needs_review` retains that decision with a zero legacy tagged amount. This preserves lifecycle choices even where the new zero financial progress differs from the retained status. Reopening goals or confirming review decisions is a separate user choice. Reload the app after a future committed reset to discard browser/SWR caches; do not infer server state from an already-open cached screen.

## Before any later execution

1. Finish the landing page and obtain the user's explicit reset execution authorization. Preparation is the only action authorized now.
2. Verify the project reference, database host and target owner UUID against the intended signed-in account. Export the owner profile, wallet and goal IDs/names alongside their email. Keep that confirmation with the reviewed script copy.
3. Take a full database backup or snapshot using the project's established backup process. Confirm that it can be restored to a separate project. Also export each table in the inventory filtered by the target owner's `user_id` (profiles/auth use `id`); export the owner's settings/category/budget definitions and all wallet/goal columns. Include shared category definitions where needed to restore relationships. Keep backup files outside Git with access restricted to the owner/operator.
4. Inspect deployed inventory before running even the rehearsal:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname;
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT c.conrelid::regclass AS child,c.confrelid::regclass AS parent,pg_get_constraintdef(c.oid)
FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace;
```

5. Compare deployed tables, columns, dependencies and triggers with the inventory. Custom balance-update triggers or cached totals need explicit review. The script deliberately aborts on drift rather than clearing unknown data. A production schema unlike the reviewed migrations remains an unresolved scope until inspected.
6. Pause app writes and background jobs for the maintenance window. The script holds exclusive locks on the reviewed public tables and a shared lock on `auth.users`. Other owners' writes wait; their rows remain intact. The 5-second lock timeout avoids waiting indefinitely. Do not run fragments outside the transaction.

## Rehearsal and later commit

Make a review copy of the SQL, replace `REPLACE_WITH_EXPLICIT_OWNER_UUID` once with the checked UUID, and keep the final `ROLLBACK`. Run the entire file in one administrative database session configured to stop on the first error (`psql -X -v ON_ERROR_STOP=1 -f <reviewed-copy.sql>`, or the whole SQL Editor batch). Capture notices for the owner scope/counts and the result table. A rehearsal runs deletes but rolls them back. It is still a maintenance operation and is not authorized on production during preparation.

The script snapshots other-owner rows and preserved owner fields, then deletes in dependency order. Only `allocation_history_immutable`, `debt_settlement_immutable` and `debt_correction_immutable` are temporarily disabled. The payment-delete reversal trigger stays enabled; settlements have already been removed, so it has no reversals to create. All guards return to their exact original `O`/`A`/`R` modes before postchecks. No permanent bypass function, grant or RLS policy is created. PostgreSQL transaction rollback restores both data and trigger DDL, including a failure before explicit re-enabling.

After rehearsal, independently compare exported before/after owner and other-owner rows, balances, progress and guard definitions/modes outside the transaction. SQL notices describing in-transaction results do not prove a committed reset.

Only after the later execution authorization and satisfactory rehearsal, change the single final `ROLLBACK;` to `COMMIT;` in the reviewed copy and run the whole file again. Do not execute this preparation artifact by accident. After any error, issue `ROLLBACK` in the same session before retrying. If the operator's tool disconnected, confirm that the transaction ended and check trigger modes before resuming traffic.

For postchecks use a literal checked UUID: all seven history tables must have zero owner rows (skip debt tables only when the entire debt bundle is absent), each retained wallet balance and `goals.current_amount` must equal zero, and wallet/goal IDs plus every other retained field must match the export. Compare profiles, categories, preferences and budgets. Sign in as the owner and read goal/debt snapshots; verify zero financial amounts while preserved lifecycle flags remain visible. Verify a second owner's snapshots/data match the backup, and compare trigger definitions/modes and RLS flags to the preflight catalog. Resume writes only after these checks.

## Disposable validation

[financial-reset-validation.mjs](financial-reset-validation.mjs) creates a new random database on a loopback PostgreSQL server, bootstraps it, seeds two owners, tests abort/dry-run/interrupted rollback/commit, and drops only the database it created. It never connects to the preserved `monetigia_test` database, never calls the old default runner, and never writes to the cluster's roles. The administrative connection must use database `postgres`; existing roles `anon`, `authenticated` and `service_role` are prerequisites. The test uses the external bootstrap file only for auth definitions/default local grants and strips its cluster-role creation statements.

PowerShell example for the existing local harness (no production credentials):

```powershell
$env:RESET_TEST_ADMIN_URL = 'postgresql://postgres@127.0.0.1:55439/postgres'
$env:RESET_TEST_PG_MODULE = 'C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/node_modules/pg/lib/index.js'
$env:RESET_TEST_BOOTSTRAP = 'C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/bootstrap.sql'
node docs/codex-review/pending-rollout/financial-reset-validation.mjs
```

The fixtures use the real migrated schema/guards. Debt INSERT validators are bypassed only while building synthetic related rows in the new disposable database, then restored before validation; financial foreign keys remain active. The tests prove deletion safety/preservation, not the correctness of debt creation RPCs. Deployment schema drift still needs the preflight comparison above.
