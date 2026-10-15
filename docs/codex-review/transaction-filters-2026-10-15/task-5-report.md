# Task 5 report

Status: DONE. Commit: `12d99ab feat(transactions): integrate full-history filtering`.

## Implementation

- Transactions page now consumes `useTransactionHistory` and its owner-pinned options directly. Server order remains authoritative across all six sorts and load-more. Search/type/wallet/category/amount/date filters now reach the full-history controller. Logical counts remain absent until a verified receipt exists; failures expose one Retry and preserve previously loaded rows.
- Applied date selection is exclusive (`all`, `preset`, `custom`). Preset changes clear custom dates; dialog wallet edits preserve presets. Custom dates unmount the preset summary/limit. Global Clear all clears search/type/all filters and returns to All time while retaining sort. Existing preset accounting remains independent and receives only a concise “List filters only” hint.
- Financial command/detail/group-proof routes remain intact. A list group's intentionally absent description proof does not grant permission or permanently disable the edit trigger: clicking Edit still loads original-operation proof and refuses missing/inconsistent proof. All owner-sensitive edit/delete/add/correction paths require goals owner to equal authenticated history owner. Details/dialogs are hidden during mismatch. A deferred old-owner correction refresh cannot set the next account's recovery flags.
- Write refresh preserves the active query and refreshes every loaded page through the controller, then reloads selected detail and group proof through the original detail loaders. Receipt-based correction recovery and refresh-only retry remain intact.
- Group bulk actions map matching transaction IDs through the exact debt snapshot to debt-row IDs. Select all and focused-list Ctrl/Cmd+A include only matching eligible rows. Explicit outside-filter selection remains possible even when matching rows are paid. Query changes clear selection; refresh prunes only missing/ineligible IDs and keeps the expanded schedule and surviving explicit outside selections.
- Recorded totals appear only in amount operations, formatted from exact decimal/BigInt strings. Native currency is preserved without FX. Unavailable canonical dates and invalid money display “Unavailable”; no guessed 1970, NaN, fake zero or PHP conversion. Canonical group transaction date is displayed in expanded details.
- Removed unused raw list loader, client list sorting/filtering/merge helpers, and their obsolete raw-list tests after migrating the only page caller. Group construction, raw single/group detail reads and original-operation proof validation remain. Server/adapter/controller tests now own sorting, paging, complete-sibling and filtering coverage; retained component/detail/proof tests still exercise those original paths.

## Narrow shared changes

- `history-format.ts`: extended the Task 4 shared formatter with canonical civil-date rendering and exact native-currency money rendering, preventing page/group drift and unsafe Number aggregation.
- `InstallmentSelection.tsx`: added optional `selectAllCount`, defaulting to the existing `eligibleCount` for all other callers. Manual activation uses all eligible IDs; bulk button availability uses matching eligible IDs. This prevents a paid matching row from making an unpaid outside sibling impossible to select explicitly.
- `history.ts`: removed the now-unused raw-list path and its helpers; retained grouping and all detail/proof behavior.

## TDD and verification

RED evidence:

1. `npx --no-install vitest run tests/transaction-history.test.tsx tests/spending-summary-panel.test.tsx` (approved elevated rerun after sandbox dependency realpath EPERM): **3 failed / 44 passed**. New group matching/exact-recorded-money and canonical-unavailable tests failed because those props were ignored; summary hint test failed because it was absent.
2. `npx --no-install vitest run tests/transaction-history-page.test.tsx -t 'renders backend matches'`: new page test failed because the old page still used raw reads and never rendered the authoritative backend match.
3. Focused `old-owner correction|metadata save` run: stale correction-owner test failed with `expected <p></p> to be null`, reproducing an old refresh creating recovery state after switching accounts. Scoped output: `task-5-owner-red.json`.
4. Focused `paid matching rows` run: failed because Select was disabled when the only matching row was paid, although an outside sibling remained unpaid. Scoped output: `task-5-selection-red.json`.

GREEN final command:

`npx --no-install vitest run tests/transaction-history-page.test.tsx tests/transaction-history.test.tsx tests/spending-summary-panel.test.tsx tests/transaction-history-filtered.test.ts tests/transaction-history-controller.test.tsx tests/transaction-filters-ui.test.tsx`

**108/108 passed across 6 files**, no warnings/errors. Includes all six authoritative sort modes across load-more, historical search without loading older pages, complete group/detail/proof behavior, metadata edits removing nonmatching entries, exclusive dates/global clear, matching-only bulk/manual outside selection, refresh pruning, owner mismatch and stale-owner recovery.

- `npx --no-install tsc --noEmit`: exit 0 after final source changes.
- Scoped `next lint` on all nine owned files: **No ESLint warnings or errors**.
- `git diff --check` and staged diff check: exit 0.
- Windows sandbox dependency realpath EPERM required approved elevated test/lint/typecheck execution; Git index write required approved elevation. No dependency installation, package/lockfile modification, production SQL, push or deployment.

## Files committed

- `src/app/(dashboard)/transactions/page.tsx`
- `src/components/transactions/InstallmentHistoryGroup.tsx`
- `src/components/transactions/InstallmentSelection.tsx`
- `src/components/transactions/SpendingSummaryPanel.tsx`
- `src/lib/transactions/history-format.ts`
- `src/lib/transactions/history.ts`
- `tests/transaction-history-page.test.tsx`
- `tests/transaction-history.test.tsx`
- `tests/spending-summary-panel.test.tsx`

## Self-review and scoped antislop gate

Inherited direction: existing Monetigia financial dashboard, compact icon-led controls, ENERGY 1 / RHYTHM 1 / MOTION 1. No assets, theme tokens or global transitions changed. Existing semantic colors and component styling remain the design source; added totals use tabular text and existing muted-foreground tokens to distinguish read-only recorded totals from remaining debt.

- R-17/R-27 PASS: verified counts come from controller receipts; loading, no matches and error/Retry states covered by focused tests.
- R-23/R-24/R-26 PASS: no assets or navigation created; added controls have real state/query actions and tested Apply, clear, sort, search and Retry behavior.
- R-02/R-15/R-16/R-31 PASS for new copy/source: concise factual labels, no decorative prose or new source comments; disclosures retain existing financial explanations.
- R-32 PASS at component-test scope: focused list shortcuts, Escape/focus return, accessible icon labels and native desktop sort remain tested.
- R-03/R-25/R-34/R-35 visual evidence remains the controller's explicitly assigned Task 6 browser/theme/width/keyboard QA. This report claims source/component integration verification, not completed visual or production acceptance.

No unresolved implementation concerns. The page remains large, although integration removed substantially more code than it added. Parent preview/harness, generated tsconfig include, plan/QA/rollout records, audit and chat files were preserved and excluded from the commit. Full suite/build/database/browser work remains assigned to Task 6.
