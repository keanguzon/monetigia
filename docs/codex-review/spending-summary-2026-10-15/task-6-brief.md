### Task 6: Period bar, filtered list and summary panel on Transactions

**Files**
- Create: `src/components/transactions/PeriodBar.tsx`
- Create: `src/components/transactions/SpendingSummaryPanel.tsx`
- Modify: [history.ts `loadHistoryPage`](file:///c:/Users/PC/Documents/monetigia/src/lib/transactions/history.ts#L307-L340): add an optional `range?: { start, end }`. When set, filter the **first** query on `date` with gte/lte. The sibling-completion query for installment groups stays **unfiltered**, so group cards remain complete.
- Modify: [transactions/page.tsx](file:///c:/Users/PC/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx): add `period` state (default: `null` for All time). Pass the range into every `loadHistoryPage` call, including load-more and `refreshLoadedHistory`. Include the period in `isCurrentHistoryRequest` and `selectionResetKey`, the same way `sortMode` is handled now. Render `PeriodBar` above the filter chips and `SpendingSummaryPanel` between the header and the list. Keep new logic inside the components; the page only wires state, because it's already over 800 lines.
- Tests: extend `tests/transaction-history-page.test.tsx` and `tests/transaction-history.test.tsx`; add `tests/spending-summary-panel.test.tsx`.

**Behavior**
- Changing the period resets the list exactly like changing sort does (new generation, clear rows, reload page one). A late response for the old period must not land.
- The summary's current period ends today; the list may still contain future-dated rows within the selected full period and complete siblings outside it. Explain this explicitly beside the period summary, mark out-of-period sibling dates, and never imply a full group amount equals period spending. Summary ignores search/type chips; include that in its subtitle.
- The list counter line becomes "Showing N {type} entries in {period label}" (or "in loaded history" on All time).
- The summary ignores the type chips and search box; it always describes the whole period. The panel's subtitle says so.
- The summary is hidden on All time and replaced with nothing (no placeholder card).

**Summary panel copy (exact)**
- Heading: the period label (e.g. "October 2026")
- Big number label: "Spent so far" (current period) or "Spent" (past period)
- Comparison: "₱X less than {previous label}" / "₱X more than {previous label}" / "Same as {previous label}". Hidden when the previous period has no rows.
- `previous label` must identify the exact comparison range, not merely its month. If comparison cannot load, show "Comparison couldn't load" with retry while retaining the current summary.
- Secondary: "Income ₱X", "Net ₱X"
- Categories: top 5 by amount plus "Debt payments" if non-zero, each as name + amount + share of spent. A sixth row "Other categories" sums the rest.
- Subtitle under the heading: "Counts expenses and card payments from your wallets. Transfers between wallets aren't counted."
- Empty (zero rows): "No spending recorded for {label}." plus the existing **Add Transaction** button.
- For income-only periods, keep Income/Net visible and use "No spending recorded for {label}." rather than hiding valid income. If excludedCurrencyTransactionCount is nonzero, show "N transactions in other currencies aren't included." even when PHP totals are zero.
- Loading: the existing `SummarySkeleton` with `aria-label="Loading spending summary"`.
- Error: "Spending totals couldn't load. Your transactions below are unaffected." with a **Retry** button that revalidates.

**Tests**
- [ ] Period change reloads the list with the new range and discards a late response from the previous period.
- [ ] Load-more and refresh after a description edit keep the range.
- [ ] An installment group with children inside and outside the period renders as one complete group.
- [ ] Panel shows the "Spent so far" label in the current period and "Spent" in a past one; comparison text for more/less/same; empty, loading and error states with their exact copy; Retry calls revalidate.
- [ ] Keyboard: period prev/next/menu reachable by Tab, operable by Enter/Space, visible focus ring.
- [ ] All time initial state; current-period Next disabled; no reversed-range requests; elapsed/full comparisons; cutoff/month midnight rollover; comparison failure and foreign-only/income-only states.
- [ ] Run `npx vitest run`, then `npx tsc --noEmit`.
- [ ] Commit: `feat(transactions): add period filter and spending summary`

---


Controller settled interfaces and scope (read before implementation):
Antislop active: during (session override), explicitly selected by user. Use existing brand/design tokens and UI patterns, not a redesign. Task4 APIs are in src/hooks/use-spending.ts, src/hooks/use-spending-owner.ts, src/lib/spending/summary.ts; read these plus periods.ts once. useSpendingSummary(period,today) returns data,error,isLoading,comparison,comparisonError,isComparisonLoading,retry. Retry revalidates both independently. Money is exact decimal strings; do not unsafe-sum decimals. Current and comparison independent; preserve current on comparison failure. Future/reversed ranges suppressed at hook layer too.
Current task does not implement limit UI (Task7 next), and must not invoke a placeholder dialog or nonfunctional Set button. Can expose a clean slot for Task7, otherwise no speculative APIs. Summary ignores search/type; make that explicit as well as provided accounting copy. No production or schema.sql edits.
All time initially; period control offers month and both cutoff halves, period prev/next and reset All time. Clamp navigation so no future selected period and avoid meaningless date state reset when local today changes. Full list range vs today summary distinction must be user-visible. Sibling completion remains unbounded; annotate outside-range installment children and full-group total where necessary. Extract narrow helper/component if page wiring would add complex logic; do not generic-refactor unrelated code.
Focused behavioral RED/GREEN tests and tsc only; full suite once Task8. Use node node_modules/vitest/vitest.mjs if npx shell wrapper fails. Escalation allowed for sandbox EPERM. Git executable C:/Users/PC/AppData/Local/Programs/Git/cmd/git.exe. Parent owns current modified plan and generated tsconfig.json include; exclude those and unrelated untracked audit/chat files from commit. Do not amend prior commits. No nested agents.
Write task-6-report.md in this plan workspace with commit, owned files, RED/GREEN evidence, no passing claims without output. Keep implementation scoped to Task6.
Existing SummarySkeleton in src/components/ui/financial-summary.tsx hardcodes aria-label="Loading summary". To satisfy task-specific accessible name without redundant nested statuses, a narrow optional aria-label prop/default there is allowed (keep old default for existing consumers). Preserve shared layout/theme otherwise.
