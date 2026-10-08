# Transactions mobile sort control brief

**Executor:** Luna max. **Review:** Sol low/medium. **Planning:** Sol medium. User's latest clarification: mobile only. At the existing `lg`/1024px breakpoint and above, preserve the present desktop tabs, search and native sort dropdown placement/appearance. No desktop redesign or sorting change.

Read AGENTS.md and the session's explicitly invoked antislop core/UI/human/mobile/code skills. Antislop during is already resolved. Keep Monetigia typography, green, theme tokens, focus and reduced motion. Comment hygiene alone changes comments only; user authorization covers this UI change. No new assets/dependencies or backend edits.

## Exact outcome

Below 1024px, the All/Expense/Income/Transfer filter row spans the content width. An icon-only filter/sort control sits at the far right of this SAME row, aligned with the content's right margin. Leave a clear gap between the filter group and icon; use flexible space, not placement immediately after Transfer. Move the two existing sort choices into its accessible radio menu. Search remains a separate full-width row beneath it. The icon button has accessible name `Sort transactions`, minimum 44px square, decorative `ListFilter` icon from installed lucide-react, and no added visible label. Icon represents the menu's ordering controls; do not add unrequested transaction filters.

## Files and preserved interfaces

Modify only `src/app/(dashboard)/transactions/page.tsx` and `tests/transaction-history-page.test.tsx`. Existing `src/lib/transactions/history.ts`, hooks, modal implementations, query/page size, request-generation logic and finance semantics remain unchanged.

Reuse `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem` from `src/components/ui/dropdown-menu.tsx`. Use installed `Button` and icon library. No new component file or shared layout abstraction needed.

Current `TransactionHistorySort = 'date_added'|'transaction_date'`, default `date_added`. Exact options remain:

- `date_added`: `Date added (newest first)`
- `transaction_date`: `Transaction date (newest first)`

Extract the current native select onChange body into local `handleSortChange(nextSort: TransactionHistorySort): void`. Both mobile radio menu and desktop native select call it. Preserve this order verbatim: same-value early return; increment `requestGeneration.current`; clear `loadMoreLock.current`; `setTransactions([])`; `setNextOffset(null)`; `setIsLoadingMore(false)`; `setLoadError(null)`; `setLoadMoreError(null)`; `setIsLoading(true)`; `setSortMode(nextSort)`. Existing effect on `[refreshKey, sortMode]` performs the load; do not also invoke `loadTransactions` from the handler. Menu callback must validate its string is one of the two literal values before passing it. Do not reset type filter or search on sort change.

Current `loadHistoryPage` orders date_added by created_at/id descending, transaction_date by history_date/created_at/id descending. Preserve group formation, sorting, stable IDs and delayed-load generation rejection. Same-choice menu selection closes without an extra read.

## Responsive/accessible implementation

- Keep the desktop native select and search wrapper's existing classes and placement at `lg`; use `hidden lg:block` around native select. Keep original desktop filter styling (`px-3 text-sm`, gaps and wrapping) through responsive class overrides.
- The existing filter group gets an outer full-width mobile flex row; use a `min-w-0` filter group, `ml-auto shrink-0` mobile trigger wrapper and at least 8px clear group-to-trigger gap. Mobile controls may use `px-1 text-xs`, 4px internal gaps and minimum 44px widths/heights to fit 320px viewport with existing page padding. At `lg`, restore original filter padding/type/gaps. Do not shorten labels, shrink below 44px or move icon to another row at the default 320px width.
- Outer controls remain stacked below `lg`; desktop existing row/grid arrangement is preserved. Once the native dropdown is hidden on mobile, remove its unused search-grid column there with responsive classes (`grid-cols-1` below lg; original desktop columns at lg). Do not leave an empty dropdown-sized gap beside search.
- Menu opens below the trigger aligned end, with collision avoidance and an opaque `bg-popover` surface. RadioGroup uses `value={sortMode}`; each RadioItem exposes checked state. Each menu item minimum 44px high, labels wrap within a viewport-bounded menu width so the long existing wording cannot overflow 320px.
- Radix handles Tab/Enter/Space, Arrow navigation, Escape, outside dismissal and trigger focus return. Icon has `aria-hidden`; button is `type="button"`, `aria-label="Sort transactions"`, 44px square with visible focus. No tooltip dependency, pulse/bounce or inline custom keyboard handler. Mobile sort menu must not be misdetected as a blocking dialog by the bottom navigation visibility hook.
- At 200% text zoom, allow the filter group to wrap internally while trigger remains in the same outer row at far right; prioritize intact text/targets over forcing one unbreakable line. At default 320px all four filters and trigger must fit without horizontal scrolling.

## Narrow execution/tests

- [ ] Update the pagination test's mobile sort interactions to click `button Sort transactions` then `menuitemradio Transaction date (newest first)`. Preserve existing exact ranges `[[0,49],[50,99],[50,99],[0,49]]`, retained default selection, retried page, removal of old Transaction 51 after sort reset and Load more restoration. Check checked radio state by opening menu, choosing value, reopening; original desktop combobox still exists with shared value.
- [ ] Add behavioral tests: trigger opens exactly two radio choices; default is checked; Enter/Arrow/Space chooses; Escape returns focus without changing sort or reload; selecting current value performs no extra query; selecting other value reloads first page once. Type filter and search values survive sort change. Extend existing query mock to record `order` calls if needed to verify unchanged date_added/transaction_date ordering without changing production history code.
- [ ] Run `npx vitest run tests/transaction-history-page.test.tsx` for RED, implement the bounded responsive menu/handler extraction, then run it for GREEN with `npx vitest run tests/transaction-history.test.tsx` and `npx tsc --noEmit`. jsdom does not prove Tailwind breakpoint layout; do not substitute class assertions for browser checks.
- [ ] Root visual check 320/375/768 mobile and 1024/1280 desktop, both themes: icon in same mobile filter row at right content margin with measured clear gap, no overflow, 44px trigger/filters, search below, readable wrapped menu and keyboard focus. At desktop compare existing tabs/search/native dropdown layout before/after; mobile icon hidden. Test bottom navigation remains present with menu, text zoom and reduced motion. No financial writes required.
- [ ] Sol low/medium reviews responsiveness, exact handler preservation and test coverage. Fix findings, report fresh focused results and layout evidence to root. No commit/push unless root separately instructs it; root integrates the small change with existing verification.
