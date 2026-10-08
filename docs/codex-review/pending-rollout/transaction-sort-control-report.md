# Transactions mobile sort control report

The Transactions page now places a 44px icon-only `Sort transactions` button at the right edge of the mobile filter row. Its Radix radio menu has the two existing sort choices, and the search input occupies a separate full-width row below. The native sort select, original filter styling, and two-column search/select grid remain at the `lg` breakpoint and above.

Both controls call `handleSortChange`. The handler retains the specified reset sequence, returns early for the current value, and leaves type and search state intact. Menu values are checked against the two supported literals before they reach the handler. The popup is a `menu`, not a dialog; the test confirms it does not expose dialog semantics that the mobile-navigation visibility hook watches for.

The tests were written before the implementation. The initial `npx vitest run tests/transaction-history-page.test.tsx` run failed in the three sort-menu-dependent cases because the `Sort transactions` button did not exist; the existing installment test passed. After implementation, fresh checks produced:

- `npx vitest run tests/transaction-history-page.test.tsx`: 4 tests passed. This covers the original pagination ranges `[[0,49],[50,99],[50,99],[0,49]]`, retry behavior, old-row removal and Load more restoration, both menu choices, checked state shared with the desktop select, no read for the current choice, one first-page read for a changed choice, retained filter/search state, and Enter/Arrow/Space/Escape behavior.
- `npx vitest run tests/transaction-history.test.tsx`: 16 tests passed.
- `npx tsc --noEmit`: exit code 0.

The query mock verifies the preserved ordering: `date_added` uses `created_at DESC, id DESC`; `transaction_date` uses `history_date DESC, created_at DESC, id DESC`.

This pass did not run a browser viewport or theme check. The jsdom tests establish menu semantics and sort behavior, but cannot measure the 320px filter row, the 200% zoom reflow, menu collision/wrapping, light/dark visuals, reduced-motion rendering, or the bottom navigation on device widths. Those checks remain for the root visual pass at 320, 375, 768, 1024, and 1280px.
