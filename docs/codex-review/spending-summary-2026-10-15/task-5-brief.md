### Task 5: Dashboard reads the same totals

**Files**
- Modify: [use-data.ts `useDashboardStats`](file:///c:/Users/PC/Documents/monetigia/src/hooks/use-data.ts#L69-L157): keep the same return shape (`monthlyIncome`, `monthlyExpenses`, `lastMonthIncome`, `lastMonthExpenses`) but fill it from two `spending_summary` calls (current and previous range) instead of raw row sums. **Include the signed-in user id in its SWR key.** Today the key is only `dashboardStats-{start}-{end}`, which is the cross-user cache leak in [audit M02](file:///c:/Users/PC/Documents/monetigia/docs/AUDIT_REPORT_gpt.md#L45). Only this hook is fixed here; `useAccounts`, `useCategories` and `useRecentTransactions` stay as they are, since M02 is its own task.
- Test: extend the existing dashboard test if one exists, or add `tests/dashboard-stats.test.tsx`.

**Steps**
- [ ] Test: given mocked RPC results, the Dashboard shows the RPC's `spent` as Expenses and its `income` as Income, for This month, Last 7 and Last 30.
- [ ] Parity test: for the same `SpendingPeriod`, the value `useDashboardStats` shows as expenses equals what `useSpendingSummary` returns as `spent`.
- [ ] Dashboard key includes owner plus all four current/previous boundary dates. Update shared refresh predicates/tests for that array key. Gate old-owner data and late responses. This does not claim the remaining generic hooks' M02 defects are fixed.
- [ ] Implement; delete the now-unused client-side filters in `useDashboardStats`.
- [ ] Run `npx vitest run`, then `npx tsc --noEmit`.
- [ ] Commit: `refactor(dashboard): read period totals from spending_summary`

---



Controller integration notes: preserve four legacy numeric fields for Dashboard display, derive them from exact validated RPC cents (no float aggregation). Use Task4 exported owner lifecycle/fetch contracts rather than duplicating auth machinery. Key ['dashboardStats',userId,currentStart,currentEnd,previousStart,previousEnd], and shared refresh matcher supports it from Task4. Gate previous owner's data/responses. Test same-range parity, late owner change, all four key endpoints, current/previous errors, current dates from Task1. Do not rewrite Accounts or RecentTransactions caches.
Expose current excludedCurrencyTransactionCount additively and display a small scoped Dashboard note if nonzero, explicitly for period income/expenses, not wallet balance. This preserves the legacy four fields while preventing newly PHP-filtered values being silently unexplained. Old Wallet total currency bug is out of scope. Root can rule on exact typed API after Task4 report. Run focused tests/typecheck; full suite once in Task8. No changes to shared summary tokens or unrelated dashboard metrics.

Task4 exact interfaces settled:
lib/spending/summary.ts: SpendingSummary, parseSpendingSummary(value:unknown), SpendingSummaryError, fetchSpendingSummary(range:{start:string,end:string},accessToken:string):Promise<SpendingSummary>. Summary money are exact strings: spent/expenses/debtPayments/income/net; categories; start/end; transactionCount; excludedCurrencyTransactionCount.
hooks/use-spending-owner.ts: useSpendingOwner():{userId,status:'resolving'|'authenticated'|'signed-out'|'error',error,generation,isLoading,isCurrent(),capture():Promise<SpendingOwnerRequest>}. Captured request:{userId,accessToken,isCurrent(),assertCurrent()}. Use one captured owner/token for both current/previous reads; assert current before publishing, gate SWR output while identity unresolved/changed. Preserve owner errors. Don't duplicate subscriptions manually.
