# Transaction Filters and Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Status:** User approved execution October 15, 2026. Implementation authorized; production SQL, push and deployment require separate authorization. This plan is separate from the completed spending feature at `0f29120`.

**Goal:** Find and sort transactions across the entire account history, with compact controls that fit mobile.

**Architecture:** A read-only, owner-scoped history RPC filters and paginates logical entries before returning their complete installment children. A small controller manages applied filters, paging and stale requests. The existing transaction cards, details and write commands remain the presentation and editing paths.

**Tech Stack:** Next.js 14, React 18, TypeScript, existing Supabase/PostgreSQL and Radix Dialog components, Vitest and disposable database tests. No additional packages.

**Spec:** The proposed design and decisions below are the self-contained draft specification. User approved this design; integration rulings are tracked in the plan-specific ledger.

## Review this first

- Six sorting options: transaction date newest/oldest, date added newest/oldest, amount highest/lowest.
- Filter by wallet, category, transaction type, amount range and a custom date range. Existing month/cutoff controls remain.
- Search and filters cover all history, including entries not loaded yet.
- One filter icon opens a mobile sheet; desktop uses a compact popover/dialog. Active choices become removable chips with Clear all.
- Spending summary remains for the selected preset period; wallet/category/search filters affect the list only. Custom date mode hides the preset spending summary for this release.
- Installment groups remain complete and appear once. A small matching count distinguishes matching installments from additional siblings.

## Proposed behavior

### Controls and defaults

Default remains All time, all types, no wallet/category/amount filter, empty search and date added newest first. Do not silently migrate to a different default.

The current sort control receives these labels:

| Value | Label |
| --- | --- |
| `transaction_date_desc` | Transaction date: newest |
| `transaction_date_asc` | Transaction date: oldest |
| `date_added_desc` | Date added: newest |
| `date_added_asc` | Date added: oldest |
| `amount_desc` | Amount: highest |
| `amount_asc` | Amount: lowest |

The filter dialog has Wallets, Categories, Amount and Dates. Keep the existing All/Expense/Income/Transfer chips outside. Multi-select wallets/categories; include an explicit Uncategorized choice. A transfer matches either its source or destination wallet. A category filter excludes transfers, since transfers have no category.

Within a field, choices are OR; different fields combine with AND. Search, type, wallet, category and date must match the same transaction row, rather than different children accidentally satisfying different conditions of a group. Amount is evaluated once at entry level as defined below.

Dialog edits are drafts until Apply. Cancel, outside dismissal and Escape discard them. Clear all removes search, type, wallet/category/amount/custom-date filters and returns to All time; preserves the selected sort. Removing one active chip changes that filter immediately. Date-range chip removal returns to All time.

Search is a literal, case-insensitive substring across the existing searchable fields: description, category name, source/destination wallet name, stored amount and recorded dates. Cap input at 120 characters and debounce requests by 300 ms. Escape SQL wildcard characters; do not accept regex or interpolate SQL. Clearing search reloads immediately.

### Dates and spending summary

Use browser-local civil dates, consistent with the approved spending feature. Existing month and cutoff navigation stays unchanged. A custom range has inclusive start/end dates, must be valid and start must not exceed end. Explicitly selected future dates are allowed for finding scheduled installments; the existing preset navigation still does not move into future periods.

There is one applied date selection: `all`, a preset month/cutoff, or a custom range. Applying custom dates replaces the preset; choosing a preset clears custom dates. Never intersect two hidden date filters.

Date matching uses `transactions.date`, including an installment's due date. Label the date section “Transaction / installment date.” Transaction-date sorting retains the existing group rule: purchase date when known, otherwise latest due date. Keep the fallback explanation in expanded details.

Spending totals retain their existing PHP accounting rules and full preset-period scope. Show one short “List filters only” hint when list-only filters are active; detailed rules stay in How totals work. For custom ranges, hide the preset summary and limit UI; do not invent a custom-period limit or send a range over the summary RPC's 366-day boundary. Custom-range aggregates can be a later feature.

### Amount and currency — review this decision

Amount matching/sorting uses a positive recorded amount, regardless of income/expense sign. An ordinary entry uses its stored amount; an installment group uses the sum of its current stored transaction children, across the complete group. This is a **recorded total**, not remaining debt or the original total before deleted records. Payments/corrections must not redefine this read-only value using mutable debt snapshots.

When amount sorting or filtering is active, a group displays a compact “Recorded total ₱X” alongside its existing remaining-debt information so the ordering is explainable. Never relabel debt remaining as recorded total.

Amount controls explicitly say “Amount (₱).” Only entries whose relevant accounts use PHP participate in amount sorting/filtering. Show a short exclusion notice and count when non-PHP/unknown-currency entries are omitted. Do not compare currencies as equivalent or introduce FX conversion. Without amount controls, foreign-currency history remains visible. Invalid historical money is unavailable and excluded from amount operations, not coerced to zero.

Bounds are inclusive canonical two-decimal strings; blank means unbounded; zero is a valid lower bound; negative, nonfinite, excess precision and min > max are invalid. Use exact SQL numeric and validated integer cents in the client, not floating-point aggregation. Reject values outside the supported transaction numeric range.

### Groups, paging and counts

Filter against owner rows, form logical candidates, apply amount rules and sort candidates, then paginate **50 logical entries**. A group is one entry regardless of its installment count. Expand all siblings only after candidate paging; siblings do not enter the matching count or change server order.

Return matching child IDs separately from complete children. Expanded siblings outside the active filters get a small “Outside filters” label. Bulk Select all only includes eligible matching IDs; it must not silently select excluded siblings. Existing correction/reconciliation safeguards remain authoritative. Individual explicit selection of a visible eligible sibling remains possible.

Every sort has deterministic tie-breakers: entry creation time, then entry key. Ascending modes have explicitly corresponding directions; null/unavailable dates sort last. The backend's ordered entry keys are authoritative; do not run the old client date sort after an amount-sorted page arrives.

Use entry-level offset paging to match the current load-more flow. On a static dataset, groups cannot repeat between pages. After writes affecting membership or order, refresh all loaded entry pages from offset zero and replace them; preserve filters and selection only for surviving eligible IDs. This does not promise a snapshot across concurrent external writes.

Display “Showing N of M matches,” counting logical entries. Do not use completed sibling rows as the denominator. During initial load, do not display a fabricated zero count. A failed load-more preserves earlier rows and exposes Retry.

## Global constraints

- Read-only filters and sorting: no balance changes, duplicated transactions, financial reset or debt reconciliation writes.
- Explicit `auth.uid()` ownership on transactions and related account/category reads; authenticated-only RPC execution, fixed search path and input validation.
- Reuse existing card/detail/edit/correction components and proof checks. A search result is not proof that a purchase may be edited or corrected.
- No query keys shared across users. Bind all request receipts to owner/generation plus normalized filters, sort and page.
- Old responses must not publish after filter changes, authentication transitions or component unmounts.
- No implementation against the stale `supabase/schema.sql`; add only a new ordered migration.
- Primary buttons use the universal primary tokens. No global theme/transition changes.
- Keep copy concise; descriptions go inside disclosures. Tap targets at least 44 px, keyboard focus visible, light/dark layouts at 320/375/768/1280 px.
- Focused tests and one scoped review per unit; one full integration pass after implementation. No repeated broad audits.
- Implementation is authorized. Production SQL, push and deployment of this filter feature require separate authorization.

## Current integration points

- `src/lib/transactions/history.ts`: currently two descending sort values, raw-row paging, unfiltered sibling completion and loaded-only search/type filtering.
- `src/app/(dashboard)/transactions/page.tsx`: currently owns history state, paging, sort/period invalidation and selection. Keep additional query logic out of this already large page.
- `src/components/transactions/PeriodBar.tsx`: existing preset navigation; extend narrowly for a custom-date display/clear state.
- `src/components/transactions/InstallmentHistoryGroup.tsx`: preserve full groups and debt proof; add matched-child annotations/recorded amount only where relevant.
- `src/components/transactions/SpendingSummaryPanel.tsx`: preserve independent totals; add only the compact active-filter hint.
- `src/hooks/use-spending-owner.ts`: existing owner lifecycle contract can be reused; do not create another auth subscription protocol.

## Review focus

1. Matching an old row beyond the first 1,000 records returns it without requiring Load more.
2. Group matching cannot combine one child's category with a different child's date; complete siblings never cause duplicate groups or accidental bulk selection.
3. Owner changes, fast search edits and stale load-more/write-refresh responses never restore an older account or filter state.
4. Recorded amount versus debt remaining is clear, and foreign currencies/invalid legacy amounts are not silently treated as PHP zero.
5. Period/custom-date state is exclusive; list filters never change spending totals or invent custom-range limits.

## Task 1: Query contract and normalization

**Files:** create `src/lib/transactions/history-query.ts`, `tests/transaction-history-query.test.ts`; extend types in `src/lib/transactions/history.ts`.

- [ ] Define `HistorySort`, `HistoryFilters`, date-selection union and `HistoryQuery` as pure typed contracts; normalize sorted/deduplicated UUID arrays and trimmed search.
- [ ] Map old `date_added`/`transaction_date` choices to their descending replacements; identify all callers, tests and expanded group fallback labels.
- [ ] Validate exact money and real inclusive calendar dates; draft invalid states must not become an applied query.
- [ ] Add failing tests for every mode, mixed filters, literal search, Uncategorized, min/max edge cases and equivalent query fingerprints.
- [ ] Implement, run focused tests/typecheck and commit `feat(transactions): define history filter contracts`.

## Task 2: Owner-scoped server filtering and logical-entry paging

**Files:** create `supabase/migrations/202610150001_transaction_history_filters.sql`, `tests/database/transaction-history-filters.test.mjs`; modify `src/types/database.ts`, narrowly allowlist the migration in `.gitignore`.

- [ ] Add `public.transaction_history_page(p_query jsonb)` returning JSON with `version`, ordered `entries`, `nextOffset`, `totalMatchingEntries`, `excludedCurrencyEntryCount` and `invalidAmountEntryCount`.
- [ ] Each entry returns its key/kind, complete rows, matching row IDs, exact recorded amount or null, currency and canonical sorting metadata. Preserve fields required by existing adapters; monetary JSON fields are strings.
- [ ] Whitelist every request key and sort mode; validate offset, array/search sizes, UUIDs, dates and money. Page size is fixed at 50; no caller-controlled SQL or owner ID.
- [ ] Use `SECURITY INVOKER`, fixed `pg_catalog, public` search path, explicit owner predicates, authenticated-only execution; private category names and destination-wallet data must never cross ownership boundaries.
- [ ] Apply same-row filter predicates before grouping, entry amount checks before paging and sibling hydration after paging. Use deterministic SQL ordering; avoid dynamic SQL.
- [ ] RED/GREEN database tests: all six sorts/ties, >1,000 rows, >50 groups, same-row conjunction, cross-page uniqueness, complete siblings, both transfer wallets, Uncategorized, exact cents, null/invalid money, PHP exclusions, hostile search, anonymous/cross-owner access and LF/CRLF reapplication.
- [ ] Inspect query plans on a realistic large fixture. Add indexes only for an observed costly predicate; reuse the owner/date index. Do not add a general search engine or speculative indexes.
- [ ] Commit `feat(transactions): add filtered history RPC`.

## Task 3: History adapter and request controller

**Files:** modify `src/lib/transactions/history.ts`; create `src/hooks/use-transaction-history.ts`, `tests/transaction-history-controller.test.tsx`; extend `tests/transaction-history.test.tsx`.

- [ ] Replace list reads with a validated RPC adapter while retaining existing single/group-detail loaders and provenance validation.
- [ ] Expose ordered entries, matching IDs/counts, loading/error/load-more/refresh actions. Do not reorder the server's pages with the legacy date comparator.
- [ ] Use the existing owner capture/current checks and monotonic request generations. Debounce search; invalidate synchronously when applied inputs change.
- [ ] Keep full normalized query on load-more, Retry and write refresh. Replace loaded pages after writes so newly nonmatching entries disappear and moved entries reorder.
- [ ] RED/GREEN tests for auth transitions, search debounce, stale query/page responses, load-more failures, preserved queries and post-edit/delete membership changes.
- [ ] Commit `feat(transactions): control filtered history requests`.

## Task 4: Compact filter and sort controls

**Files:** create `src/components/transactions/TransactionFilterDialog.tsx`, `src/components/transactions/TransactionFilterChips.tsx`, `src/components/transactions/TransactionSortControl.tsx`, `tests/transaction-filters-ui.test.tsx`; modify `PeriodBar.tsx` narrowly.

- [ ] Reuse Radix Dialog for a mobile bottom sheet and compact desktop presentation; one Filter icon with an active count, no duplicated visible filter forms.
- [ ] Provide wallet/category selections, optional min/max and date inputs, Apply/Cancel/Clear all. Use loaded option names, include archived/referenced choices where accessible; failures must not look like no choices.
- [ ] Render six sort choices with concise labels; native accessible selections on desktop and existing dropdown patterns on mobile.
- [ ] Show removable active chips that wrap without document overflow. Hide the chip row when empty.
- [ ] Add validation, draft discard, Reset/Apply, keyboard/Escape/focus-return tests. Ensure switching presets clears custom dates and vice versa.
- [ ] Commit `feat(transactions): add compact filter controls`.

## Task 5: Page, group and summary integration

**Files:** modify transactions `page.tsx`, `InstallmentHistoryGroup.tsx`, `SpendingSummaryPanel.tsx`; extend `tests/transaction-history-page.test.tsx`, `tests/transaction-history.test.tsx`, `tests/spending-summary-panel.test.tsx`.

- [ ] Wire the controller and controls, replacing loaded-only search/type logic. Keep financial commands, details and correction lifecycle intact.
- [ ] Derive one active date selection and preserve query across edits/payments/corrections. Clear selection when filters change; prune selections after refresh.
- [ ] Honor matching IDs for bulk selection; label additional siblings Outside filters. Show Recorded total only during amount operations.
- [ ] Keep preset spending totals unchanged by list filters; custom dates hide preset summary/limit. Display concise counts and empty/error recovery.
- [ ] RED/GREEN integration tests for complete matching groups, consistent six-mode order across load-more, old-history search, membership changes after metadata edits and no accidental selection of filtered-out siblings.
- [ ] Commit `feat(transactions): integrate full-history filtering`.

## Task 6: Integration QA and rollout record

**Files:** create `docs/codex-review/transaction-filters-qa-2026-10-15.md`; targeted plan allowlist for this document when committing the approved plan.

- [ ] Run full frontend/Node tests, sequential disposable database suites, typecheck and production build. Avoid a concurrent build during timed UI tests; the prior feature exposed resource-contention timeouts.
- [ ] Browser QA: filter Apply/Cancel/Clear/chip removal, all six sorts, search beyond page one, load-more/Retry, custom/preset switching, selection and metadata refresh. Use synthetic data only.
- [ ] Verify 320/375/768/1280 widths, both themes, keyboard focus, iPhone-like sheet scrolling and concise copy. Record screenshots and actual observations; physical iPhone/PWA remains a separate acceptance step.
- [ ] Independent final review with one scoped fix round. Preserve evidence and leave unrelated audit/cache/security work outside this feature.
- [ ] Supply a read-only catalog check and ordered installation instructions for the new RPC. Verify production migration before releasing dependent frontend code; do not assume Git push executes SQL.
- [ ] Commit the QA checkpoint. Push/deploy only on explicit subsequent authorization.

## Not included

Saved filter presets, export, full-text/fuzzy search, an all-purpose reporting builder, FX conversion, custom-period spending aggregates, transaction amount/type editing, global cache remediation, financial reset and changes to theme transitions.
