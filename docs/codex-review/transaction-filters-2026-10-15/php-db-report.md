# PHP-only database retirement report

Status: DONE_WITH_CONCERNS (focused database contracts pass; full browser/unit/legacy database verification belongs to controller Task 6).

## Change

New forward migration: `supabase/migrations/202610150002_php_only_currency_retirement.sql`.
- Locks accounts and preferences and rejects every account/preference currency distinct from PHP, including NULL. It never converts, relabels, updates balances, rewrites transactions or financial operation records.
- Replaces the eleven currently currency-dependent SQL functions with complete definitions. No runtime text replacement or historical migration/schema modification.
- Drops accounts.currency and user_preferences.currency; retains remaining authenticated opening insert grants and existing RLS/update grants.
- Leaves handle_new_user entirely untouched, preserving deployment-specific signup behavior.
- Retains owner/existence, proof, reconciliation, idempotency, numeric and identity checks. Amount history explicitly retains owner-joined source/destination existence, separately from invalid numeric exclusion.

## Exact client contracts

- `debt_account_create(uuid,jsonb,jsonb)`: new p_account has exactly eight keys: name, type, color, icon, is_savings, interest_rate, include_in_networth, display_order. Types/constraints otherwise unchanged. No currency key for new requests.
- A nine-key old p_account containing currency=PHP is accepted only when its existing completed operation exactly matches its immutable command/hash and passes existing result/account/item validation. New requests with currency=PHP fail INVALID_STATE; USD/null fail INVALID_STATE; retrying old request with currency removed fails REQUEST_CONFLICT. Stored old operations remain byte-equivalent JSON values.
- `transaction_history_page(jsonb)`: signature/version/filters/order/paging/entries/rows unchanged except entries no longer contain currency and top-level excludedCurrencyEntryCount is absent. invalidAmountEntryCount stays, and counts invalid numeric groups with owner-joined source/destination accounts in amount mode.
- `spending_summary(date,date)`: excludedCurrencyTransactionCount is absent. start/end/spent/expenses/debtPayments/income/net/categories/transactionCount remain.
- Debt state fingerprint input no longer contains account.currency. Outstanding amounts, reconciliation and proof remain; pre-retirement quotes/fingerprints should be refreshed at deployment.
- account and user_preferences rows no longer contain currency. No denomination selection is supported.

## Test accounting and setup

`tests/database/helpers.mjs` now exposes explicitly named installPrePhpMigrations (through 202610150001) and keeps installLatestMigrations as all migrations. Eight historical test files have mechanically renamed installer imports/calls only. Their USD/history/reapplication assertions are unchanged. These 163 historical contracts run on the pre-retirement disposable HTTP fixture; they intentionally do not claim final-runtime coverage.

`tests/database/php-currency-retirement.test.mjs` adds eight native current-runtime contracts using its own fresh database, bootstrap and historical migrations. It never applies cleanup to the preview/legacy HTTP fixture. It requires the configured TEST_DATABASE_ADAPTER to expose createIsolatedDatabase(), returning {queryAdmin,close}; queryAdmin must retain one SQL session for BEGIN/SET LOCAL auth. Parent's ignored adapter provides this factory. The suite runs in the same test:db glob once configured; adapters without that factory fail clearly rather than skipping final coverage. Generic psql-only setups need an equivalent factory before running this suite.

Focused command: `node .superpowers/sdd/2026-10-15-transaction-filters-and-sorting/run-php-db.mjs` (sets existing disposable environment and imports native test).
Final focused result: 8 tests, 8 pass, 0 fail, 0 skipped, fresh DB dropped afterward.
Coverage: foreign/null account/preference rollback; both column absence; unchanged money/signup/immutable operations; LF+CRLF reapply; signup after drop; eight-field creation + legacy replay; grants/owner/numeric/identity guard; reserve/expense/transfer/replay/stale quote; debt payment/adoption/correction/reconciliation; summary/history retirement fields; ownership provenance; exact 0.10+0.20 grouping and same-child filters; invalid money exclusion.

TDD evidence: initial ordered-migration test failed ENOENT before migration existed. During native verification six contracts passed and summary/history contract failed on the removed `included` SQL alias, then the alias fix produced 7/7 pass. Expanded owner/provenance contracts produced 8/8 pass after matching the existing trigger error message. This was not a complete behavior-first red/green cycle for every replaced function; controller should not describe it that way.

Full `npm test` was attempted: the initial eight node tests passed, then Vitest had 52 unhandled EPERM realpath errors for node_modules/vitest/dist/spy.js, with no Vitest tests collected (sandbox restriction). No application test failure could be assessed from that attempt. Controller should rerun with suitable permissions in Task 6. Parent requested no duplicate broad database run; full 163+8 database run remains for Task 6.

Self-review: checked complete function changes, absence of other live currency-dependent function bodies, owner-joined provenance, unchanged old operation hash/command, preserved grants and historical assertions. `git diff --check` passed (only local CRLF conversion notices).

## Rulings

1. Preserve historical contracts in the pre-retirement phase and add explicit final-runtime coverage in a fresh DB — historical USD fixtures cannot truthfully run against a schema with no currency field. Cost if wrong: test environment setup changes, never production money changes.
2. Accept legacy PHP only for completed matching operation replay — preserves immutable hashes while rejecting denomination input for new commands. Cost if wrong: a client must refresh/reissue new-form commands instead of retrying an old request with a changed shape.
3. Preserve owner-joined account eligibility for amount filters independently of denomination — removing currency must not admit cross-owner account references as valid amount entries. Cost if wrong: imported malformed entries remain excluded in amount mode as before.

Owned files: new SQL migration; new native final-runtime test; helpers; the eight mechanically renamed historical test files; one migration .gitignore allowlist. Frontend, schema.sql, historical migrations, preview data and production were untouched.
