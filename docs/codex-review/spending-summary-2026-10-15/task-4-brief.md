### Task 4: Client data layer and hooks

**Files**
- Create: `src/lib/spending/summary.ts`: calls the RPC, validates the response shape, converts money strings with the existing minor-unit helpers (the same ones `financial-summary.tsx` uses), and throws one typed error on a malformed response
- Create: `src/hooks/use-spending.ts`
- Modify: `src/lib/refresh-financial-data.ts` (extend existing owner-scoped refresh matching and retain refresh-error recovery).
- Inspect consumers: `src/hooks/use-transaction-submit.ts`, `src/hooks/use-transaction-description.ts`, debt command/correction hooks and category writes; add narrow refresh wiring only where the existing shared refresh path is absent.
- Modify: [use-data.ts](file:///c:/Users/PC/Documents/monetigia/src/hooks/use-data.ts) (only in Task 5)
- Create: `tests/spending-hooks.test.tsx`

**Produces**
- `useSpendingSummary(period: SpendingPeriod | null, today: Date)`: returns `{ data, error, isLoading, comparison, comparisonError, isComparisonLoading, retry }`. Use separate SWR requests keyed `["spending-summary", userId, start, end]` for the current effective range and `comparisonRange(...)`. A null period (All time), unresolved owner or reversed effective range means no request. Retry revalidates both; an unavailable comparison never replaces valid current data with zero.
- `useSpendingLimit()`: returns `{ limit: { amount, cadence } | null, error, isLoading }`. Key: `["spending-limit", userId]`.
- `useSpendingLimitCommand()`: returns `{ save(amount, cadence), remove(), isSaving, error }`. Uses an upsert on `user_id`; remove deletes the row. Revalidates the limit key.
- Extend `refreshFinancialData(userId, mutateCache, cache)` to match owner-scoped spending-summary and dashboardStats array keys. Reuse the existing scoped SWR cache and saved-but-refresh-failed contract; do not introduce a second global mutation bus. Revalidate after confirmed saves, deletions, supported date/category metadata edits and category-name changes. Include debt payments/reversals if they change counted transaction rows. Pure reservations/corrections without counted-row changes need no new spending semantics. Never replay a committed write merely because refresh failed.

**Steps**
- [ ] Tests first: the key changes when the period changes; no fetch for All time; a malformed RPC payload becomes an error state, not zeros; switching user drops the previous user's data; a successful transaction save triggers revalidation, and a failed save does not.
- [ ] Include late old-owner responses and owner-bound limit save/remove attempts. Pin owner identity at action start, gate unresolved identity, and keep errors distinct from absent limits. Never reuse an old owner's form against a newly authenticated owner.
- [ ] Verify shared-cache invalidation after date/category edits, deletion, payment/reversal and category rename, plus scoped dashboard refresh. Inspect actual write paths: ordinary wallet creation uses direct insert, not exclusively financial RPCs. Add only relevant wiring; wallet opening balance is not automatically a spending transaction.
- [ ] Implement. Owner checks follow the same pattern as the existing hooks (current user id read from the session, used in the key).
- [ ] Run `npx vitest run tests/spending-hooks.test.tsx`, then `npx tsc --noEmit`.
- [ ] Commit: `feat(spending): add spending summary and limit hooks`

---



## Controller supplements
Use existing refreshFinancialData scoped-cache matching, not a new global mutation bus. Existing TransactionDescriptionEditor supports DATE/CATEGORY now and useTransactionDescription already calls shared refresh. Trace consumers before adding redundant calls. Add summary/dashboard array keys with user filter; Task5 changes dashboard hook next. Category rename updates categories.name used by RPC, so add narrow category-save refresh wiring and meaningful error handling without refactoring unrelated category behavior. Currency summary excluded count is returned by Task2; use exact strings and signed net. Aggregates outside safe centavo parsing yield an explicit load error, never zeros/crash.
Fetch current/comparison independently, query current end=min(period.end,today); if future start>end suppress BOTH current and comparison. No request for All time. Owner-bound keys alone insufficient: subscribe auth, gate user transitions/stale responses/limit writes, preserve signedout vs identity error, use generation guards. No broad fixes for unrelated generic hooks.
Implementation sequencing: Task5 will change useDashboardStats; do not edit that hook in Task4. You MAY introduce an owner-lifecycle hook scoped to spending if it makes the two readers + limit command share identity handling, in a small new src/hooks/use-spending-owner.ts module. Task5 may consume it. Document exact exports/contracts in report. No provider-wide cache architecture refactor. Add spending_summary RPC declaration in src/types/database.ts if needed to avoid any. Existing summary.ts minor helpers return safe integer cents; reject unsafe/malformed aggregates as a load error. Limit absence distinct from failed SELECT. Qualified category changes include DELETE (FK null makes Uncategorized), not just rename.
Current useTransactionDescription already passes its scoped cache to refreshFinancialData after writes. Preserve saved-vs-refresh failed behavior and original request identities. Do not add duplicate write retries. Limit upsert/remove owner pinned at start, returned row checked. Use source lookup for category save/delete callbacks before wiring; no unnecessary refresh for creation of an unused category.

Limit amount readback: use PostgREST amount::text select (including returned upsert fields) so the client receives exact two-decimal string, rather than floating numeric JSON. Keep type inference honest; add RPC types if needed. Don't claim a JSON numeric financial amount is exact without a recoverable contract.
