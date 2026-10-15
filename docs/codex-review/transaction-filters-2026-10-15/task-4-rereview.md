antislop active: during (session override).

Spec compliance: APPROVE.
Task quality: APPROVE.

- Resolved: `src/components/transactions/TransactionSortControl.tsx:36` uses an icon-only `h-11 w-11` trigger and preserves its selected-sort accessible name and tooltip.
- Resolved: `src/lib/transactions/history-format.ts:1` provides one unchanged date-range algorithm; `PeriodBar.tsx:15` and `TransactionFilterChips.tsx:36` consume it instead of duplicating it.
- Verified in the scoped diff: native title attributes were removed from period, filter-dialog, chip and mobile-sort controls while their aria-labels and Tooltip wrappers remain.
- No remaining findings in the requested repair scope. Read the fix diff and appended report only; no Git commands, tests, source reads or source edits.
