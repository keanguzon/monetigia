# Spending summary release

Status: implementation, local QA and independent reviews complete. Production has not been inspected or changed by this feature's implementation session. Installation through `202610090001_transaction_metadata.sql` was previously reported successful by the user; that report does not establish current catalog parity. See the [QA record](../spending-summary-qa-2026-10-15.md).

## Before deploying the frontend

1. Open the intended production project's SQL Editor as `postgres`.
2. Run [spending-function-parity.sql](spending-function-parity.sql). This reads function bodies as hashes, execution settings and effective grants. It includes the financial dispatcher, debt operations and metadata wrapper. Before the two new migrations, only `public.spending_summary(date,date)` and `public.set_spending_limit_updated_at()` may be `MISSING`. All existing functions must match. Preserve the results.
3. Run [spending-schema-inspect.sql](spending-schema-inspect.sql). Existing debt tables must be installed with RLS enabled, and the transaction date/category/installment columns must exist. A missing `spending_limits` table is expected only before its migration.
4. If an existing function differs, inspect that specific definition against the ordered migrations before proceeding. A hash difference can include formatting drift; the status identifies a review requirement rather than proving a financial bug. Do not repair drift by reapplying `supabase/schema.sql`, or by running the old financial reset scripts.
5. After the existing catalog is verified and local feature QA is approved, run the complete contents of `supabase/migrations/202610140001_spending_summary.sql`, then `supabase/migrations/202610140002_spending_limits.sql`, in that order. Each migration has its own transaction. Neither migration resets balances or creates transaction records.
6. Rerun both read-only checks. Every function must now match. Verify the new table against the expectations below. If the API schema cache has not refreshed, use `NOTIFY pgrst, 'reload schema';` after successful installation.
7. Deploy the frontend only after those checks succeed. Verify Transactions → Month against Dashboard → This month for the same account and date. Check setting, editing and removing a limit with a test account.

The parity query was generated from the ordered migrations installed on disposable local PostgreSQL. It normalizes CRLF before hashing. The query checks named migrated functions; it is not an exhaustive security audit of unrelated database objects.

## Expected new schema

- `spending_summary(date,date)`: stable, security invoker, fixed `pg_catalog, public` search path; authenticated can execute; anonymous and service_role cannot execute through grants.
- `spending_limits`: RLS enabled; one row per `user_id`, foreign key to `public.users(id)` with delete cascade; positive finite `numeric(15,2)` amount no greater than `9999999999999.99`; cadence `month` or `cutoff`; creation/update timestamps.
- Four authenticated owner policies: SELECT/DELETE use `auth.uid() = user_id`; INSERT checks it; UPDATE both uses and checks it. Authenticated has SELECT/INSERT/UPDATE/DELETE. No anonymous, PUBLIC or service_role grants. Owner/superuser privileges in SQL Editor are expected.
- Update trigger calls `set_spending_limit_updated_at()` before each update. Its function has a fixed `pg_catalog` search path and no direct application-role execute grants.
- Transactions has an unconditional valid index whose first two columns are `user_id, date`. An existing suitable index is reused; the index name does not have to be `transactions_owner_date_idx`.

## Acceptance boundaries

The feature uses PHP cash-basis spending: noncredit expenses and cash-to-credit payments count; credit purchases and transfers between noncredit wallets do not. Period summaries ignore list search/type filters. Installment groups can show complete sibling history outside the selected period; their full amount is not the period's spending total. Limits are guidance and never block recording expenses.

Production parity, production installation and physical iPhone Safari/PWA acceptance must be recorded separately from local desktop/browser QA. No production SQL, push or deployment is authorized merely by this document.
