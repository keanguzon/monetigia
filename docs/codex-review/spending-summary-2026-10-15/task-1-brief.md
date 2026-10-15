### Task 1: Period helper and confirming the Dashboard date bug

**Files**
- Create: `src/lib/spending/periods.ts`
- Create: `tests/spending-periods.test.ts`
- Modify: [dashboard/page.tsx](file:///c:/Users/PC/Documents/monetigia/src/app/(dashboard)/dashboard/page.tsx#L34-L69) (replace `getDateRange` internals only)

**Produces (later tasks rely on these names):**
- type `PeriodKind` = `"month" | "first_half" | "second_half"`
- type `SpendingPeriod` = `{ kind, start: string, end: string }` (both `yyyy-MM-dd`, inclusive)
- `periodContaining(date, kind)`, `shiftPeriod(period, step: -1 | 1)`, `previousPeriod(period)`
- `spentToDateEnd(period, today)`: returns the earlier of period end and today
- `isCurrentPeriod(period, today)`
- `comparisonRange(period, today)` using the comparison policy above
- Create `src/hooks/use-local-today.ts` for midnight/focus/visibility recomputation; test cleanup and a tab returning across month/cutoff boundaries.
- `formatPeriodLabel(period)`: e.g. "October 2026", "Oct 1–15, 2026", "Oct 16–31, 2026" (the en dash in a date range is fine; R-02 bans only em dashes)
- `toLocalDateString(date)`: `yyyy-MM-dd` via date-fns `format`

**Steps**
- [ ] Write a failing test that runs the **current** Dashboard range logic with `TZ=Asia/Manila` and a clock at 2026-10-01 00:30. It should expect current start `2026-10-01`. If the test **passes**, the bug isn't real: drop the Dashboard change from this task, note it in the report, and keep only the helper.
- [ ] Write helper tests: Feb 2026 second half ends the 28th; Feb 2028 ends the 29th; next after Dec 16–31 is Jan 1–15 of the next year; previous of Jan (month) is Dec of the prior year; `spentToDateEnd` clamps to today in the current period and returns the full end for past periods; the label strings above.
- [ ] Implement the helper with date-fns (`startOfMonth`, `endOfMonth`, `addMonths`, `format`). No UTC conversions.
- [ ] Point the Dashboard's `getDateRange` at the helper for "This month". Last 7 and last 30 days keep their shape but use `toLocalDateString`.
- [ ] Run `npx vitest run tests/spending-periods.test.ts`, then `npx tsc --noEmit`. Expected: pass, exit 0.
- [ ] Commit: `feat(spending): add local period helper and fix dashboard date range`

---
