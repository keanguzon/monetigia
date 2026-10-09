# Task 7.2 implementation report

Implemented the complete snapshot-backed debt history ledger and routed credit-purchase deletion through debt correction. Credit corrections require an exact owner/account/group/transaction match against a complete purchase snapshot; missing, stale, unbalanced, or settled rows cannot fall through to ordinary deletion. Cash installment deletion keeps its existing path.

The account schedule keeps every snapshot row for history, including settled and corrected rows, while its payable summaries continue to use positive balances. Credit ledgers display immutable snapshot ordinals and exact decimal amounts. History controls keep selection local to the expanded group, reset it on page changes, and scope keyboard shortcuts to the focused list. Page-level recovery preserves the saved command kind and refreshes debt plus loaded history without hiding purchase transactions.

Focused coverage includes complete and incomplete snapshot joins, standalone credit purchases, disabled settled deletion, full snapshot rows, selection resets, scoped shortcuts, and page recovery.

Verification:

- `npx vitest run tests/debt-selection.test.tsx tests/debt-correction-ui.test.tsx tests/transaction-history.test.tsx tests/transaction-history-page.test.tsx tests/debt-snapshot-view.test.tsx tests/transaction-release.test.tsx` — exit 0; 6 files and 96 tests passed.
- `npx tsc --noEmit` — exit 0.
