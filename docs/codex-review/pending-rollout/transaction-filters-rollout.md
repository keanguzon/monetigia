# Transaction filters and PHP-only rollout

Local QA is complete. Production SQL, push and deployment have not been performed.

1. Confirm preceding migrations through `202610140002_spending_limits.sql`. Apply only pending migrations; never rerun `schema.sql` or the historical baseline.
2. Run complete `supabase/migrations/202610150001_transaction_history_filters.sql`, then `supabase/migrations/202610150002_php_only_currency_retirement.sql` as `postgres`.
3. The second removes account/preferences currency columns and updates dependent functions. It does not convert money, change balances, delete wallets or rewrite transaction/operation history. It stops atomically for any non-PHP or NULL denomination; investigate instead of relabelling money.
4. Run [the read-only catalog check](transaction-filters-catalog-check.sql): eleven MATCH rows and one REMOVED row are expected. Custom signup behavior is unchanged.
5. Coordinate installation and frontend deployment while financial writes are paused. Old clients still submit/read currency fields; refresh browser/PWA afterward and refresh stale quotes. Completed legacy PHP requests retain exact replay compatibility.
6. Check search, six sorts, combined filters, installments and editing on a test account. Physical iPhone/PWA acceptance remains manual.

No financial reset is included. Historical migrations and sealed operation payloads retain old fields as migration/audit history; live denomination fields, selectors and conversions are absent. All amounts display pesos.

[Local QA record](../transaction-filters-qa-2026-10-15.md)
