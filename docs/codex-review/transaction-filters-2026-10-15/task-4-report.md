# Task 4 report

Status: DONE. Implemented the compact, controlled transaction filter and sort controls and narrowed `PeriodBar` for custom dates.

## Changes

- `src/components/transactions/TransactionFilterDialog.tsx`: Radix mobile bottom sheet / desktop dialog with wallet and category multi-selects, Uncategorized, PHP amount bounds, inclusive custom dates, option loading/error/retry states, archived and unavailable selections, Reset, Apply, global Clear all, validation, and draft discard on Cancel/Escape/outside close. Non-date edits retain a selected preset; explicit date edits switch to custom or all-time.
- `src/components/transactions/TransactionFilterChips.tsx`: immediately removable, wrapping chips for search, type, wallets, categories, Uncategorized, amount and custom dates; hidden when no filters are active.
- `src/components/transactions/TransactionSortControl.tsx`: all six sort modes in an accessible native desktop select and the existing mobile radio-menu pattern.
- `src/components/transactions/PeriodBar.tsx`: optional custom-range label, disabled preset stepping while custom, and menu controls that allow switching to a preset or All time. Existing callers remain compatible.
- `tests/transaction-filters-ui.test.tsx`: 13 focused interaction tests covering preset preservation, custom-date editing and validation, amount validation, reset/apply/clear separation, cancel/Escape/focus return, loading/error/retry, archived/unavailable options, chips, six sorts and custom-period behavior.

## Verification and TDD

- RED: `npx vitest run tests/transaction-filters-ui.test.tsx` (approved elevated rerun after the default Windows sandbox hit Vitest dependency realpath EPERM) failed at the expected missing `TransactionFilterDialog` module before implementation.
- GREEN: `npx --no-install vitest run tests/transaction-filters-ui.test.tsx` — **13/13 passed**.
- `npx --no-install tsc --noEmit` — exit 0.
- `npx --no-install next lint --file src/components/transactions/TransactionFilterDialog.tsx --file src/components/transactions/TransactionFilterChips.tsx --file src/components/transactions/TransactionSortControl.tsx --file src/components/transactions/PeriodBar.tsx --file tests/transaction-filters-ui.test.tsx` — no ESLint warnings or errors.
- `git diff --cached --check` — clean before commit. The focused tests, TypeScript and lint used the installed dependencies only; none were installed or modified.

## Self-review

The dialog does not duplicate the external search/type controls. Apply sends normalized `HistoryFilters` and the exclusive date selection; parents retain ownership of applied state, sort and global clear behavior. Options are passed in, so these components do not start a second history/auth lifecycle. Unrelated QA/rollout documents, audit/chat files and the parent's `tsconfig.json` edit remain unstaged. Full suite and browser integration QA belong to Task 6.

No outstanding concerns.

## Scoped review repair

- Replaced the mobile sort label with a 44px icon-only trigger. Its accessible name and the existing tooltip retain the selected sort; the menu still shows the six choices.
- Removed native `title` attributes from the filter dialog, chips, sort control and period controls so tooltips have one presentation path.
- Extracted the duplicated custom date-range algorithm into `src/lib/transactions/history-format.ts`; chips and `PeriodBar` now use `formatHistoryDateRange`.
- Added regression coverage for the icon-only accessible trigger, 44px target, tooltip, absence of native titles, and matching period/chip date labels.

TDD evidence: The new focused test first failed to resolve the not-yet-created shared formatter module. After extracting it, the suite reached the icon assertion and failed because the mobile button still contained “Date added: newest.” After removing the visible label and native titles, the fresh focused suite passed **14/14**. `npx --no-install tsc --noEmit` exited 0. Scoped Next lint across the formatter, four controls, period bar and UI test reported no warnings/errors. All checks used installed dependencies only. Review repair commit follows separately.

Review-fix commit: b485e7e fix(transactions): tighten compact filter controls.
