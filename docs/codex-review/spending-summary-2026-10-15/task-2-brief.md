### Task 2: `spending_summary` RPC (complete, owner-scoped totals)

**Files**
- Create: `supabase/migrations/202610140001_spending_summary.sql`
- Do **not** modify `supabase/schema.sql` (see Global Constraints, audit M03).
- Create: `tests/database/spending-summary.test.mjs` (use `createFinanceFixture` / `cleanupFinanceFixture` from `tests/database/helpers.mjs`, like the other suites)

**Produces:** RPC `public.spending_summary(p_start date, p_end date) returns jsonb` with this shape. All money values are 2-decimal strings.
- `start`, `end`
- `spent` (= expenses + debtPayments), `expenses`, `debtPayments`, `income`, `net` (= income − spent)
- `categories`: list of `{ categoryId | null, name, amount }`, sorted by amount descending, where null means "Uncategorized"
- `transactionCount`: qualifying PHP expense, debt-payment and income rows only; unrelated transfers and credit purchases do not make an empty spending period nonempty.
- `excludedCurrencyTransactionCount`: otherwise qualifying rows excluded because the source or, for debt payments, destination currency is not PHP. Count each transaction once; never convert FX or label foreign units as pesos.

**Instructions**
- Owner is always `auth.uid()`. There's no user parameter. If there's no session, raise `NOT_ALLOWED`.
- Validate: both dates present, `p_start <= p_end`, range no more than 366 days. Otherwise raise `INVALID_RANGE`.
- Apply the spending rules table exactly. Join `accounts` for the type of both `account_id` and `transfer_to_account_id`. Join `categories` for names, and keep a category's current name if it still exists.
- Apply explicit same-owner predicates to related account/category reads; respect default/shared category eligibility. Aggregate PHP only under the currency policy above. Excluded foreign rows are reported, never silently converted.
- `SECURITY INVOKER` (RLS stays in force) **and** an explicit `user_id = auth.uid()` filter. Mark it `STABLE`. Fixed `search_path`. Grant `EXECUTE` to `authenticated` only.
- Check that an index on `(user_id, date)` exists. If it doesn't, add `transactions_owner_date_idx` in the same migration.

**DB tests (assertions written as test names)**
- [ ] `counts non-credit expenses and card repayments once, ignores card purchases and wallet-to-wallet transfers`
- [ ] `groups by category with Uncategorized for null category and keeps debt payments out of categories`
- [ ] `is exact for 1,200 expenses in one month` (guards against the 1000-row cap)
- [ ] `includes rows on the start and end dates and excludes the day before and after`
- [ ] `returns another user's rows to no one` (owner A sees only A's rows; a direct call as `anon` is denied)
- [ ] `rejects reversed ranges and ranges over 366 days with INVALID_RANGE`
- [ ] `installs from raw CRLF and raw LF text with identical function body and grants` (audit M25; send the file bytes as-is, without the helper's LF normalization, for both new migrations)
- [ ] `matches the current useDashboardStats arithmetic for a mixed fixture` (compute both ways in the test)
- [ ] PHP totals exclude foreign source/destination currency as applicable, count excluded rows once, and never add credit purchases or wallet transfers to transactionCount.
- [ ] Run `node --test --test-concurrency=1 tests/database/spending-summary.test.mjs` using the configured disposable harness environment. Do not append a focused filename to the npm script, which already expands all DB test files. Expected: all pass.
- [ ] Commit: `feat(spending): add owner-scoped spending_summary RPC`

---



## Controller execution context
Work in C:/Users/PC/Documents/monetigia (worktree sandbox fallback). Native Git executable: C:/Users/PC/AppData/Local/Programs/Git/cmd/git.exe. Existing untracked audit/export files are user-owned; leave them alone. Preserve schema.sql and existing migrations.

Fresh native disposable fixture is running on PostgreSQL127.0.0.1:56739 spending_fixture, REST56740. Its adapter/runner live in .superpowers/sdd/2026-10-15-spending-summary-and-limit. Focused command: node .superpowers/sdd/2026-10-15-spending-summary-and-limit/run-db.mjs tests/database/spending-summary.test.mjs. Use require_escalated if sandbox blocks loopback/runtime. Runner installs latest repo migrations then executes tests under fixture env. Do not use production config, old monetigia_test, or hardcoded external audit cluster. See ledger for LF/CRLF semantic parity ruling. Baseline 15 financial tests passed.

Do not fetch database defaults as evidence of live state. Ensure current migration grants/policies remain intact. Repeated installs must be safe; no existing function-body surgery. PHP-only otherwise-qualifying transactions, source/destination owner/type as applicable, count excluded currency once, no FX. transactionCount counts qualifying included expense/payment/income (not credit purchases or pure transfers). Returns signed two-decimal net, other money nonnegative. No report of successful empty totals for permission/read failure.

Allowlist .gitignore addition for this migration only (current file may already contain root's separate plan allowlist). No broad ignore removal. If adding RPC generated types is necessary, defer to Task4 or report exact requirement. Minimal source documentation; test raw migrations without weakening existing test harness normalization.
