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
