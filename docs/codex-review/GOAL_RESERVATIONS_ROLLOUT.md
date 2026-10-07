# Goal reservations rollout

Local implementation is authorized. Remote push, production SQL, permission cutover, merge, and deployment require separate authorization.

## Schema evidence and required deployment preflight

The former `supabase/schema.sql` was a destructive reset. It omitted `transactions.goal_id` and the goal priority, category, allocation amount, and cadence columns already used by the application. The 2026-10-05 Goals plans specify those additions. The runtime account types also require savings, interest, net-worth inclusion, and display order. Migration `202610060001_runtime_baseline.sql` reproduces these columns on an empty database and adds missing known columns without changing old financial values.

The deployed schema and existing transaction deletion RPC remain unverified. The available public credentials do not expose their definitions. No live database write has been performed. Before finalizing deployment SQL, an authorized operator must capture this read-only evidence from the actual deployment:

```sql
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
       numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS relation, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE connamespace = 'public'::regnamespace;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public';

SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proconfig, p.proacl,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';

SELECT event_object_schema, event_object_table, trigger_name, action_statement
FROM information_schema.triggers
WHERE event_object_schema IN ('public', 'auth');

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants WHERE table_schema = 'public';
```

Identify the deletion RPC called by the deployed app, including its complete overload signatures, grants, owner checks, balance reversal, debt, and installment behavior. Compare the evidence with both migrations. Resolve differences additively and rerun disposable database tests. Do not invent or overwrite a missing RPC body.

## Additive ledger behavior

Pre-existing goals become `needs_review`; their old `current_amount`, completion flag, tagged transactions, and balances retain their values. Legacy completion maps to lifecycle status `completed` without inventing a completion timestamp. New goals default to `active` and `confirmed`. Reapplying the migration preserves a goal's review and lifecycle decisions. No legacy transaction becomes an allocation event automatically.

Allocation deltas use exact PostgreSQL `numeric` with a two-decimal scale check and the same range as `numeric(15,2)`. A literal `numeric(15,2)` column rounds excess decimal places before constraints can reject them. The checked numeric columns reject such input instead. New RPC money inputs must also validate decimal strings before any casts and return canonical two-decimal strings.

Composite foreign keys bind each event's goal, wallet, operation, and reversal to the same owner. Authenticated clients can read their history through `auth.uid()` but cannot directly write events or operations. Event updates and deletes fail, including service-role edits. Whole-user deletion remains possible for disposable fixture cleanup and account erasure; this is the sole history deletion exception. An account or goal with allocation history cannot be deleted independently.

The event's `transaction_id` retains the original UUID after transaction deletion. An insert trigger checks that a referenced transaction exists and belongs to the owner. This retained identifier deliberately has no deletion foreign key because setting it to null would modify immutable history.

## Disposable database verification

Use an isolated Supabase project, apply the baseline and ledger migrations in order, and set the following environment variables through a private shell or ignored environment file:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_ANON_KEY`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_DATABASE_DISPOSABLE=true`
- `TEST_DATABASE_URL`, a direct PostgreSQL connection URI used by `psql`; optionally `TEST_PSQL_PATH`.

Then run `npm run test:db`. The test harness creates two independent users, signs each in, creates fixtures, and deletes the fixture users afterward. It never falls back to the application's live environment variables. Database test files run serially so upgrade checks cannot race other test files.

For the local native PostgreSQL/PostgREST setup, use `TEST_DATABASE_ADAPTER` pointing to an ignored module exporting `queryAdmin(sql, params)`, `createUser(email)`, and `deleteUser(id)`. The adapter must return PostgreSQL rows and signed authenticated access tokens. This replaces GoTrue fixture setup only; schema, constraints, privileges, RLS, JWT verification, and HTTP database calls still execute in real PostgreSQL/PostgREST. The ignored local runner loads its own test configuration without reading the application's `.env`.

The upgrade test builds and drops a uniquely named isolated schema in the disposable database. It verifies first-upgrade preservation and safe reapplication. Never run the test suite against production.

## Credit-card opening-balance audit before cutover

No live account balances were audited during local implementation. Before cutover, record each card's stored `accounts.balance` with its review timestamp and compare it with a statement-anchored ledger calculation: statement-confirmed opening debt plus card expenses and transfers from the card, less card income and transfers to the card, through the same cutoff. Record the statement date, transaction coverage, derived amount, stored amount, and difference for each card. If a trustworthy starting statement or complete transaction coverage is unavailable, mark the comparison unresolved and obtain a statement or other source evidence before proposing a correction.

Keep this reconciliation separate from Wallets' normalized monthly debt buckets. Those buckets preserve the current payment and cash-advance preview signs and month filters; they do not establish an opening balance. Never overwrite stored credit debt with a month-derived sum during fetch or use a page load to repair a discrepancy. Any correction needs a separate review with source evidence and explicit confirmation.

## Coordinated cutover

1. Capture the deployed-schema evidence above and audit existing debt discrepancies without correcting balances automatically.
2. Apply reviewed additive migrations after deployment authorization. Verify legacy goals require review and newly created goals are confirmed.
3. Update every financial writer to the atomic RPC lane, including expense, transfer, installments, deletion, legacy adoption, and lifecycle actions. Remove fetch-time balance writes.
4. Audit old RPC grants and restrict direct transaction, balance, lifecycle, and allocation mutations as a coordinated cutover. Retain opening-balance account creation and safe metadata changes.
5. Run integration and owner-isolation checks, then verify the user examples and cache refresh behavior.

Once reservations exist, a rollback to legacy writers can corrupt available money. Preserve ledger history and use a forward fix or temporarily disable writes if the cutover fails.

## Writer audit and review lane

The local source audit covers every `from(...).insert/update/delete` and `rpc(...)` call under `src`. Transaction creation, installments, deletion, reservations, legacy review, and goal lifecycle actions use `goal_finance_apply`; quotes use `goal_transaction_quote`. Goals create and edit metadata through `use-goals.ts`. `AddGoalModal` supplies an initial zero current amount and false completion flag; the database validates those opening values. Wallet creation remains in `AddAccountModal` and `AddAccountForm`. Wallets writes only account names, ordering, APY, and net-worth inclusion, plus deletion of wallets without financial history. Account, Dashboard, transaction, and SWR reads do not repair balances. Categories and user profile/settings writes do not mutate goal funds.

Migration 006 denies authenticated transaction/event/operation DML, balance changes, account identity/type/currency/active-state changes, and goal ownership/current-amount/lifecycle/review/archive changes. It replaces column privileges with explicit creation and metadata allowlists and adds a restrictive owner boundary, so an older permissive RLS policy cannot broaden owner access. Safe PHP wallet opening balances, account name/color/icon/order/APY/net-worth inclusion, and goal metadata/targets remain available. A wallet with transaction or allocation history cannot be deleted; allocation-backed wallet identity cannot change even through a privileged direct update. Deleting a goal directly is disabled; closing and archiving use the finance command.

Legacy review explicitly selects active PHP cash-wallet reservations, a lifecycle status, and optional existing cash expenses or cash-to-card payments for debt goals. Old tags, amounts, and wallet balances stay intact. Historical imports append spent-only events with unique transaction IDs; they never charge the wallet again. Replaying the same request returns its original result before validating the now-confirmed goal or deleted historical transaction. A second review with another request is rejected, as is importing a transaction already counted by another goal. Deleting an imported transaction follows the normal financial reversal and reverses its spent-only event with no invented reservation. Completed and cancelled reviews add no reservations. An expense previously used as fake savings needs normal transaction correction; review neither reverses it automatically nor reserves unavailable money.

## Verified local function inventory and unknown deployed RPCs

The disposable native database inventory contained the three public finance endpoints, private `goal_reservation_apply` and `goal_transaction_apply`, the allocation owner/immutability triggers, the identity guard, and the existing registration trigger. All security definers reported `search_path=pg_catalog, public`. This inventory is local evidence only. The actual deployed deletion RPC's name, overloads, body, and grants remain unknown.

Migration 006 fails closed for other public security-definer functions and private goal/guard helpers: it revokes execution from PUBLIC, anon, authenticated, and service_role, retaining only the three reviewed public finance endpoint signatures. Trigger invocation continues to work without direct execution grants. No guessed deletion RPC body is created or replaced. The security test creates and revokes a clearly named disposable old deletion fixture RPC solely to prove the bypass is denied; it is not evidence of a deployed function's name or implementation.

Before deployment, review the captured complete function inventory, including every exposed API schema, overload, function owner, security mode, search path, table grants, column grants, role membership, inherited grants, and default privileges. Identify all existing financial RPC callers. Confirm unknown or old mutation endpoints are revoked for every calling role, including grants inherited through PUBLIC or another role. If a reviewed nonfinancial endpoint must remain callable, add its exact signature to the reviewed deployment allowlist and rerun owner/security tests before cutover. Do not regrant unknown functions merely to restore an old client.

## Operator cutover checklist

1. Obtain separate production/deployment authorization. Capture a restorable database backup and the schema/function/grant inventory; test restoring the backup into an isolated environment before changing production.
2. Complete the statement-based card opening-debt discrepancy audit above. Record unresolved comparisons and review corrections separately; do not replace balances with monthly debt previews.
   Audit existing account balances and goal target/allocation amounts for null, nonfinite (`NaN`/infinity), negative or out-of-domain values, including zero goal targets. Targets must be positive; opening balances and allocation amounts may be zero. Migration 006 rejects newly written authenticated opening balances and goal money, but does not rewrite existing legacy values. Record any invalid legacy rows for a separate source-backed correction before enabling affected financial actions. Unrelated metadata edits do not silently repair those amounts.
3. Rehearse migrations 001 through 006 on a disposable copy with representative legacy rows, followed by standalone 005/006 reapplication and the reproducible `schema.sql`. Confirm balances, old tags, review decisions, and imported history survive reapplication.
4. Coordinate the application writer release with migration 006. Pause writes or use a maintenance window during the cutover so an old client cannot submit through the legacy direct-write lane. Apply the additive baseline/ledger/RPC migrations, switch every writer, then enforce the reviewed grants and endpoint revocations. Verify the final state, not an intermediate migration state.
5. Confirm owner-scoped reads, safe metadata/target edits, safe wallet creation, quote/confirmation, transaction/deletion, legacy review, close/reopen/archive, retry replay, and denied direct writes as ordinary authenticated users. Verify no unknown public definer endpoint or overload remains callable.
6. Monitor failed mutations and financial-operation completion. If the cutover fails, disable affected writes and apply a forward fix. Preserve operations, append-only allocation history, and idempotency IDs. Never roll back to an application that writes balances or transactions directly while reservations exist.

Local automated tests create uniquely named users and remove only those users. They do not reset the separate preview user. The final reservations test restores the current transaction/lifecycle/guard migrations after exercising the older reservation dispatcher. Rendered browser verification and deployment preflight remain separate gates; local test results are not a live database audit or permission to deploy.
