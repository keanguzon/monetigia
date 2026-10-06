# Task 1 implementation report

Status: DONE_WITH_CONCERNS. Task 1 storage and reproducible test harness are implemented and verified locally. No product UI, RPC financial behavior, live database writes, push, deployment, or merge was performed.

## Requirements and files

- `supabase/migrations/202610060001_runtime_baseline.sql`: additive, transaction-wrapped runtime baseline; reproduces profile, accounts, categories, goals, transactions, budgets, preferences, owner RLS, indexes, and registration behavior on an empty Supabase-compatible database. Adds missing known account columns, old goal fields/cadence, and transaction goal link. Existing policies and registration function/trigger are retained, not overwritten. No reset or auth deletion SQL.
- `supabase/migrations/202610060002_goal_allocation_ledger.sql`: exact checked numeric deltas; owner-composite foreign keys; request uniqueness; lifecycle/review defaults; immutable event triggers; retained transaction UUID with same-owner validation; one reversal per source; owner/history indexes; owner-scoped read policies; no authenticated direct ledger/operation writes.
- `supabase/schema.sql`: safe baseline plus ledger bundle, replacing the former destructive reset. Ordered migrations remain source of truth.
- `tests/database/helpers.mjs`: explicit disposable-environment guard, separate owner clients, fixture setup/cleanup, conventional Supabase auth and psql mode, optional ignored native admin/auth adapter, migration runner, operation/event utilities. No fallback to app/live environment or logging credentials.
- `tests/database/ledger.test.mjs`: nine real database tests, including pinned names and required literal assertions.
- `src/types/database.ts`: goal status, review_state, completed_at, archived_at; FinancialOperation and GoalAllocationEvent row types. Raw PostgREST numeric rows are `string | number`; event Inserts require strings; event Update is `never`.
- `package.json`: `test:db` uses `node --test --test-concurrency=1 tests/database/*.test.mjs`.
- `.gitignore`: exact exceptions for two migrations, schema, approved reservation plan/spec. Keeps infrastructure, configs, previous ignored plans, and unrelated migrations ignored.
- `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`: runtime evidence, required read-only deployed schema/RPC audit, disposable reproduction, migration semantics and cutover requirements.

## Downstream contracts

`financial_operations`: id, user_id, request_id, command_hash (64 lowercase hex SHA-256), command JSONB, result JSONB nullable, created_at, completed_at nullable. Unique (user_id,request_id) and (user_id,id).

`goal_allocation_events`: id, user_id, goal_id, account_id, operation_id, kind, reserved_delta, spent_delta, transaction_id nullable retained UUID, reversal_of nullable unique UUID, created_at. Kinds: reserve, release, spend, move_in, move_out, legacy_spent, reversal. Nonzero pair required. reversal kind iff reversal_of non-null. Composite same-owner references for goal, account, operation, reversal; deferrable foreign keys preserve whole-user cascade cleanup while independently rejecting wallet/goal deletion with history.

A transaction UUID must belong to the event owner at insertion. A reversal may retain an already-deleted transaction ID only if it matches its same-owner source event. Immutable history prevents service-role update/delete too, except a complete user/profile erasure cascade. Financial operations are writable by the authoritative server lane so it can finalize results; clients have owner reads only.

New goal defaults: active/confirmed and null timestamps. Pre-existing is_completed=true maps to completed and every old goal becomes needs_review; legacy flags/amounts/tags/balances remain unchanged and no completion timestamp is invented. Null-only initialization keeps a confirmed/cancelled decision after safe reapplication.

## Approved plan adaptations

1. Controller approved exact unrestricted NUMERIC plus `abs(delta)<1e13 AND scale(delta)<=2` instead of literal NUMERIC(15,2): PostgreSQL applies the typmod and silently rounds 0.001 before a CHECK/trigger could reject it. Tested excessive scale in either delta, overflow, NaN, zero pairs, and exact 0.01. New RPC inputs must validate decimal strings before casts; UI totals must use decimal-text RPC/view output rather than raw JSON numeric event rows.
2. Controller requested `--test-concurrency=1` across database test files, preventing upgrade DDL from racing other files. Explicit within-test concurrency is still available for later operation tests.
3. Native PostgreSQL 16.15 and PostgREST execute actual constraints, triggers, RLS, roles, signed JWT authorization and HTTP reads/writes. Ignored SQL/JWT adapter replaces GoTrue fixture-user setup only. Conventional Supabase auth option also exists; no remote disposable project was used.

## TDD and command evidence

Tests were written before the ledger implementation. The baseline was created first to reproduce current behavior on the empty native database.

- `node --test tests/database/ledger.test.mjs` without TEST variables: exit 1, 0/9, clearly reports the missing TEST_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY names only. This verifies the guard, not the feature RED.
- Early native runner attempt before PostgREST startup: exit 1, 0/9, Local PostgREST unavailable. Infrastructure startup resolved this; not counted as feature RED.
- Genuine baseline-only `node .superpowers/local-db/run-test.mjs tests/database/ledger.test.mjs`: exit 1, 0/9. Seven tests fail because financial_operations does not exist (PGRST205); lifecycle test asserts undefined != active; upgrade test fails because the ledger migration is absent. Separate user/owner fixture HTTP setup succeeds.
- After writing/applying ledger: same native runner exit 0, 9/9, zero failures. `npx tsc --noEmit`: exit 0.
- `npm test`: exit 0, 2/2 Node tests and 10/10 Vitest tests across two files. No suite failures or warnings.
- Stronger self-review assertions (explicit 42501 for authenticated event/operation writes; goal deletion FK rejection; baseline reapplication preservation): native serial runner exit 0, 9/9.
- Actual `npm run test:db` under the native adapter environment: exit 0, 9/9; confirms package command and serial file flag.
- Conventional psql admin adapter characterization using the same native REST/auth fixture setup: initially exit 1, 8/9. Upgrade failed connecting to default localhost:5432 because PGDATABASE treated the URI as a name instead of applying its host/port. A minimal direct psql probe with separate PGHOST/PGPORT/PGUSER/PGDATABASE connected correctly. Fixed helper to parse the URI into private libpq environment variables, including password and standard SSL options; nothing sensitive goes in command arguments. Re-run: exit 0, 9/9, including upgrade and safe reapplication.
- Final `npx tsc --noEmit`: exit 0. `git diff --check`: exit 0 (Git notes line-ending normalization for schema only).

Passing database tests:

1. owner-scoped allocation reads (assert.equal(otherUserEvents.length, 0))
2. allocation references enforce the same owner
3. invalid precision, zero values, and unknown kinds are rejected
4. request IDs are unique per owner
5. allocation writes are restricted and history is immutable
6. transaction deletion retains the original event reference
7. one event can be reversed once by the same owner
8. new goals default to confirmed active lifecycle
9. upgrade preserves legacy finances (assert.deepEqual(after.balances, before.balances), plus tags and legacy amounts/flags)

The upgrade test uses a unique isolated schema, seeded old completed goal, tagged expense, nonround wallet balance, and legacy funded amount. It reapplies the baseline unchanged, applies the first ledger upgrade, then confirms/cancels the goal and reapplies ledger. It verifies zero automatic events and exact preserved balance/tag/amount data.

## Self-review and delivery gate

Reviewed file scope, constraints, composite owner references, immutable deletion paths, retained transaction ID reversal path, new/old goal defaults, command/request indexes, RLS and permissions, schema reapplication and fixture cleanup. Fixtures delete their two auth users; all database tests and cleanup hooks complete. Ignore checks confirm local private config and adapter stay ignored, and old plan files stay ignored. No secrets or local infrastructure are staged. Comments explain constraints and non-obvious compatibility reasons. Documentation claims match observed evidence; no UI assertions are made. Visual/layout gates do not apply to this storage-only task.

## Concerns and deployment blockers outside Task 1

- The actual deployed schema and existing deletion RPC definition remain unavailable via the public key. Read-only operator preflight is required before deployment SQL is finalized; the rollout document includes exact catalog queries. No RPC body was invented.
- Conventional GoTrue create/sign-in branch was implemented but not executed against a remote disposable Supabase project. Both native queryAdmin and psql migration paths were executed; real database/JWT/REST isolation passed.
- Raw PostgREST NUMERIC JSON is unsuitable as the new exact-money boundary. Future financial RPC/history reads must cast amounts to decimal strings before JSON encoding.
- Existing transaction/balance/goal lifecycle writers retain compatibility permissions until later tasks implement all atomic writers and perform the coordinated restricted cutover. Task 1 does not claim those writers are secured yet.

## Commit

Local commit `44d4bd03cd9e36a42c3b9e7a6253b67e19819085` (`feat: add goal allocation ledger and reproducible schema`). Exactly nine Task 1 deliverables were staged and committed. Approved plan/spec remain untracked for the controller to commit. Fresh pre-commit verification repeated native DB 9/9, npm test 2 Node +10 Vitest, and tsc exit 0 after the psql helper fix.

## Review fix round 1: service-role TRUNCATE bypass

Independent review found that `GRANT ALL` included TRUNCATE. Row-level update/delete triggers never run for TRUNCATE, so the service role could erase the immutable allocation history.

Added `service role cannot truncate allocation history`. It inserts an actual event and reads the entire history through the service-role HTTP client. A single implicit SQL transaction switches locally to service_role and attempts the real TRUNCATE. If TRUNCATE succeeds, a sentinel exception immediately rolls it back; a permission failure also rolls back. No explicit BEGIN or open transaction is left in the pooled adapter, and SET LOCAL ROLE is reverted. The test then compares all history rows with their original snapshot before asserting that the actual denial was SQLSTATE 42501 (or the equivalent psql permission-denied diagnostic). The existing disposable-environment guard remains mandatory.

TDD RED at review head `44d4bd0`: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/ledger.test.mjs`, exit 1, 9 passed / 1 failed. The focused test failed with `Allocation TRUNCATE unexpectedly succeeded`. Its history-preservation assertion passed, confirming the sentinel rollback protected every row during the failing run. Remaining tests and cleanup completed normally.

Changed the additive ledger migration to grant only SELECT/INSERT/UPDATE/DELETE to service_role and explicitly REVOKE TRUNCATE on both allocation events and financial operations. Explicit revocation also removes the old privilege on migration reapplication. Regenerated the safe schema bundle from the two migrations and applied only the ledger migration on the native disposable database.

TDD GREEN: same native serial runner, exit 0, 10 passed / 0 failed. Focused truncate test passes, original history remains byte-for-byte equivalent through JSON row comparison, later tests run normally, and fixture cleanup completes. `npm test`: 2/2 Node +10/10 Vitest, all pass. `npx tsc --noEmit`: no diagnostics. `git diff --check`: exit 0; only Git line-ending notices. Reviewed diff scope: ledger migration, matching schema bundle, focused test. No later-task functionality, remote push, live database writes, deploy, or merge.

Fix commit: `db1e3eaea39d4349f9b1a1664b116e2c7d86c22c` (`fix: prevent service-role allocation history truncation`), local only.
