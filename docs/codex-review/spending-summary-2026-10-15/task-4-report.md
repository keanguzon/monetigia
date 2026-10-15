# Task 4 report

Implemented and committed as `141bed3` (`feat(spending): add spending summary and limit hooks`), based on `3f98be5`. Eight scoped source/test files; no dashboard hook, Transactions layout, limit dialog, financial write semantics, migrations, or production changes.

## Verification

- First Vitest invocation hit sandbox `EPERM` resolving its installed spy module. Authorized native retry worked. The initial missing-module failure was followed by empty export scaffolding and an actual behavioral RED: 11/11 assertions failed, including wrong/missing money values, absent owner lifecycle, and spending/dashboard caches remaining at 1 after refresh.
- Implemented the data layer: 11/11 GREEN.
- Category callbacks: 3 failing behavior assertions and one existing rejection behavior passed before wiring. One initial ambiguous text query was fixed before accepting RED. Missing rename/delete refresh left the summary at Food, and missing refresh-failure feedback never produced the saved/error toast. After narrow wiring: 4/4 GREEN.
- Additional Strict Mode regression RED: abandoned initial getUser lookup replaced owner-b with owner-a. Fixed by an effect-local active flag, independent of the shared mounted ref. This test now passes.
- Final focused run: `npx vitest run tests/spending-hooks.test.tsx tests/category-spending-refresh.test.tsx tests/goal-finance-hooks.test.tsx tests/transaction-description-hooks.test.tsx tests/debt-hooks.test.tsx`: **60/60 passed across five files** (17 spending, 4 category, 15 goal finance, 6 metadata, 18 debt), no warnings/unhandled errors. Additional dispatcher integration fixture initially omitted the transaction quote; corrected that fixture, with no production change.
- `npx tsc --noEmit`: exit 0.
- Staged whitespace check: exit 0 after removing one trailing blank line from the category test. Scoped commit amended for that whitespace only; final SHA above.
- Full suite intentionally deferred to integration, as directed by controller/ledger.

## Exact exports and contracts

`src/lib/spending/summary.ts`:

- `SpendingSummary`: `{ start, end, spent, expenses, debtPayments, income, net, categories, transactionCount, excludedCurrencyTransactionCount }`. Money fields are exact two-decimal strings, net is signed; categories are `{ categoryId: string | null, name: string, amount: string }[]`. Counts must be safe nonnegative integers. Money passes existing centavo parsers/converters; malformed/unsafe aggregates do not become zeros.
- `SpendingSummaryError`: typed malformed-response/range-mismatch error.
- `parseSpendingSummary(value: unknown): SpendingSummary`.
- `fetchSpendingSummary(range: { start: string; end: string }, accessToken: string): Promise<SpendingSummary>` invokes typed RPC with explicit owner bearer, propagates server errors, validates payload and returned endpoints. Task5 must capture owner first and assert current after awaiting.

`src/hooks/use-spending-owner.ts`:

- `useSpendingOwner()` returns `{ userId: string | null, status, error: unknown | null, generation: number, isLoading: boolean, isCurrent(): boolean, capture(): Promise<SpendingOwnerRequest> }`.
- Status is `resolving | authenticated | signed-out | error`. Signed-out differs from identity lookup failure. Auth subscription is installed before getUser; later auth events supersede initial lookup. Unmount and Strict Mode abandoned effects cannot publish identity. Same-owner token refresh does not change identity generation; sign-out/re-entry does.
- `SpendingOwnerRequest`: `{ userId: string, accessToken: string, isCurrent(): boolean, assertCurrent(): void }`. Capture gates unresolved/signed-out/stale callbacks, checks getSession owner after awaiting, and pins the bearer. `assertCurrent()` rejects superseded requests even after sign-out and same-owner sign-in.
- `SpendingOwnerChangedError`: account-transition/identity-verification error.
- Task5 usage: `const request = await owner.capture(); const data = await fetchSpendingSummary(range, request.accessToken); request.assertCurrent(); return data;`.

`src/hooks/use-spending.ts`:

- `useSpendingSummary(period: SpendingPeriod | null, today: Date)` returns `{ data, error, isLoading, comparison, comparisonError, isComparisonLoading, retry }`. Current and comparison SWR requests/errors are independent. Keys are `["spending-summary", actualOwnerId, start, end]`. Current end is min(period end, local today). All time, unresolved owner, and reversed future effective range suppress both calls. Retry returns `Promise.allSettled` for both SWR mutations.
- `SpendingLimitValue`: `{ amount: string, cadence: "month" | "cutoff" }`.
- `useSpendingLimit()` returns `{ limit, error, isLoading }`. Actual SELECT absence returns null; unresolved/failed data is undefined, signed-out is null, errors remain explicit. Key `["spending-limit", actualOwnerId]`. SELECT is `user_id,amount::text,cadence`; every returned row is validated for owner, positive exact amount and cadence.
- `SpendingLimitSaveOutcome`: `{ saved: SpendingLimitValue | null, refreshError: unknown | null }`.
- `useSpendingLimitCommand()` returns `{ save(amount: string, cadence), remove(), isSaving, error }`. Both actions return `Promise<SpendingLimitSaveOutcome>`. Save uses owner-pinned upsert with `onConflict: "user_id"`; removal filters owner and validates returned deleted rows. Both select `amount::text`. Identity, validation, write and malformed receipt failures throw and populate current-owner error; confirmed saved/deleted writes return their receipt with a separate refreshError even when revalidation fails. No committed write is replayed on refresh failure.
- Task7 should bind its form to the owner/generation from `useSpendingOwner` and ignore an old attempt's completion after an owner transition. Old captured command callbacks are already rejected; an in-flight confirmed old-owner write returns its original receipt without publishing errors/loading to the replacement owner.

`src/types/database.ts`: adds typed spending_summary RPC declaration; spending_limits numeric field types permit string writes/readback without `any` or floating JSON precision assumptions.

## Refresh paths inspected and verified

- Shared `refreshFinancialData` matcher now includes owner-scoped spending-summary and dashboardStats arrays. Existing scoped cache and FinancialRefreshError recovery remain unchanged. Other-owner arrays do not refresh. Legacy dashboard string matching remains until Task5 moves dashboard reads.
- Existing ordinary transaction submit and deletion flow through useGoals/useGoalFinance/shared refresh. Debt payments use ordinary transfer commands; reversal uses delete_transaction. Direct dispatcher integration test verifies expense, debt payment and deletion refresh, while a rejected save does not.
- Existing useTransactionDescription refreshes history and shared financial cache after successful supported metadata edits. Added real hook integration proof for date/category edits; no duplicate refresh trigger added.
- Existing debt command/correction hooks use shared refresh after saves; 18 focused debt tests remain green. No new spending semantics were added for pure reservation/correction paths.
- Categories page lacked shared refresh: added it only after confirmed rename and delete. Delete matters because FK null shifts amounts to Uncategorized. Failed refresh displays saved-vs-refresh-failed feedback and never replays the write. Creation of unused categories remains unchanged.
- Ordinary wallet creation is a direct account insert, not a financial RPC. Its opening balance does not itself create a counted transaction; no extra spending refresh/wallet write behavior added.

## Remaining integration boundaries

- Task5 still owns useDashboardStats, including the owner array key with all endpoints and aggregate interpretation.
- Task7 owns owner-bound dialog lifecycle, presentation and refresh-error recovery UI. Hooks provide exact receipts/errors; no dialog created here.
- Full frontend/database/build acceptance belongs to Task8. Native/local testing does not imply production verification or physical device QA.
- Parent's concurrent approved-plan changes and unrelated untracked audit/chat export files were preserved and excluded from the commit.
