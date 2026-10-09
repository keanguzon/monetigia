# Unit 8.1 implementation handoff

Status: source implementation is ready for focused verification and review.

`EditTransactionDescriptionCommandSchema` adds a strict metadata command with one UUID target and a 500 Unicode code point limit checked before trimming. `normalizeTransactionDescription` trims only U+0009–U+000D and U+0020, mapping an empty value to `null`. The command uses the existing financial RPC and rejects quote arguments. The owner-keyed hook retains the exact UUID and normalized command after an unknown response, exposes known error codes, clears a saved attempt before parallel history and finance refresh, and provides read-only refresh recovery.

Migration `202610080006_transaction_description.sql` adds `goal_transaction_description_apply(uuid,jsonb,jsonb)` as a `SECURITY DEFINER` function with `search_path=pg_catalog,public`. It authenticates and locks the owner before request lookup, replays completed identical requests before checking current rows, locks goals/accounts/affected transactions in order, and writes only `transactions.description`, `updated_at`, and a completed metadata operation. Group edits prove membership from the original transaction operation and its ordered result IDs, retain original ordinals after deletion, require the exact terminal suffix generated for each live child, allow a null purchase date, and reject missing or heterogeneous proof.

The migration amends the two current `debt_account_state` source-claim predicates by requiring `candidate.command->>'kind'='transaction'`. Its guarded source check accepts exactly the two original predicates or exactly the two amended predicates for reruns; migration `202610080005_debt_snapshot_adoption.sql` remains unchanged. The dispatcher amendment checks the current adoption and correction branches, inserts the metadata branch at the guarded adoption anchor, and fails if the expected source is absent.

The private metadata helper revokes execution from PUBLIC, anon, authenticated, and service_role. The existing `goal_finance_apply` authenticated and service_role grants are preserved, anon remains denied, and authenticated direct transaction UPDATE remains denied. No write-context GUC was added.

## Verification

The focused Vitest files passed 20 tests total: command contracts 4/4, client transport 10/10, and owner-keyed hook recovery 6/6. The first hook run exposed shared module state between cases; each case now uses its own owner ID, and the affected hook suite passed on rerun. `npx tsc --noEmit` exited 0 after the hook implementation and owner-switch recovery fix.

The disposable database suites passed sequentially through the supplied local wrapper: transaction description 6/6, debt snapshot 6/6, debt adoption 5/5, debt corrections 4/4, debt settlements 13/13, and final installed state 6/6. The description suite verifies expense and income balance invariance, repeated purchase/payment edits, group isolation and ordinal retention after deletion, null and malformed suffix cases, stale and replay behavior, owner isolation, paid/reversed/corrected debt history, and private grants. The final-state suite installs migrations in chronological order and exercises the existing creation, snapshot, adoption, correction, metadata edit, archive, and restore paths through their RPCs.

Sol low review found one P2 owner-switch recovery gap. The hook now leaves an owner-scoped `refreshError` when a successful write returns after the selected owner changes, and the saved owner can clear it with read-only refresh. The added deferred-response regression passed with the hook suite. No production SQL was applied and no commit was created.
