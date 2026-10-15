# Task 3 report

Commit: `c6b3a9e feat(transactions): control filtered history requests`.

Four owned files committed: `src/lib/transactions/history-filtered.ts`, `src/hooks/use-transaction-history.ts`, `tests/transaction-history-filtered.test.ts`, `tests/transaction-history-controller.test.tsx`. Adapter extracted into an adjacent module under the brief's scoped-extraction allowance. Existing `history.ts`, raw `loadHistoryPage`, single/group detail loaders, financial commands and provenance helpers remain intact until Task 5 integration. Parent harness, QA/rollout docs and unrelated audit/chat files untouched.

## Integration API

`useTransactionHistory(input?: Partial<HistoryQuery>)` owns history and option reads through one `useSpendingOwner` lifecycle. Caller supplies normalized applied filters/sort/search/date bounds; input offset is always reset to zero by the hook. Search text can remain immediate in page state; only reads debounce 300ms. Every changed normalized query invalidates old receipts synchronously during render and hides its old rows/counts. Non-search changes and clearing search read immediately. Equivalent normalized inputs keep the same identity.

Returned fields:

- `userId`, `ownerStatus`, normalized `query`, owner/generation/filter `queryKey`.
- `entries: FilteredHistoryEntry[]`, `matchingRowIds: string[]`, `nextOffset: number|null`.
- `totalMatchingEntries`, `excludedCurrencyEntryCount`, `invalidAmountEntryCount`: each `number|null`; initial/unresolved values are null rather than fabricated zero. Showing count is `entries.length` (logical entries).
- `isLoading`, `isLoadingMore`, `isRefreshing`, `error: unknown|null`.
- `loadMore(): Promise<void>`, `refresh(): Promise<void>`, `retry(): Promise<void>`. Visible failures reject and remain available through `error`. `retry` reruns the failed read mode only; it never invokes a financial command. Load-more and refresh errors preserve earlier rows. Refresh supersedes outstanding reads, captures one owner/token for its entire operation, reads all previously loaded logical pages from offset zero, and replaces them atomically, stopping early if history shrank. A stale refresh rejects so command refresh-only retry cannot claim an older account/query receipt succeeded. Stale initial/more reads discard results. Duplicate keys/row IDs across pages become an explicit refresh error rather than duplicate groups.
- `options: {wallets,categories,isLoading,error,retry():Promise<void>}` has independent loading/error/retry state and does not block history. Option failures expose no fabricated empty success state. Wallets `{id,name,type,currency,isActive}` include accessible inactive accounts; categories `{id,name,type:'income'|'expense',color:string|null}` include only own and shared default categories. Reads explicitly filter owner and pin Authorization to captured token; no generic cross-user cache. Options persist across query changes but hide immediately on owner changes. No second auth subscription.

`FilteredHistoryEntry = TransactionHistoryEntry & {matchingRowIds:string[],recordedAmount:string|null,currency:string|null,transactionDate:string|null,createdAt:string,sortId:string}`. Backend envelope order is authoritative; **never pass these entries through legacy sortHistoryEntries/filterHistoryEntries**. Complete children remain intact. Use matchingRowIds for bulk matching-eligible selection; detail/proof loaders remain the authority for edit/correction eligibility. Every hydrated row has null descriptionProof, so a list receipt cannot grant description write proof.

`loadFilteredHistoryPage(client,userId,query:HistoryQuery,accessToken):Promise<FilteredHistoryPage>` and `parseFilteredHistoryPage(value:unknown,userId,query:HistoryQuery):FilteredHistoryPage` are exported from `history-filtered.ts`. Page has ordered entries, nextOffset, all three numeric counts. Runtime validation covers strict envelope/rows, UUIDs and related IDs, owner, duplicate entry/row IDs, key/group consistency, matching-ID subset/uniqueness, canonical exact total (computed with BigInt), creation/sort metadata membership, dates, count/page-size/next-offset consistency and PHP/valid-money rules in amount mode. Valid group totals above the per-row numeric bound and safe integer cents remain exact strings.

`loadHistoryFilterOptions(client,userId,accessToken):Promise<HistoryFilterOptions>` is also exported. Option schemas/owner/default checks validate responses; no active-only predicate excludes archived wallets.

## Task 5 rendering notes

- Nullable RPC legacy `row.date` becomes the existing card model's **empty string unknown sentinel**. purchase_date/history_date remain null; canonical entry.transactionDate remains null. No 1970 or guessed date is invented. Guard all ordinary and child date rendering before invoking date formatting; show Date unavailable. For group transaction-date display, canonical `entry.transactionDate` is authoritative even if a valid latest due child exists and malformed purchase metadata caused RPC to return null.
- Invalid legacy numeric text (NaN/Infinity/negative) remains visible outside amount mode, with recordedAmount null and grouped remainingAmount null. Guard generic formatCurrency for such rows; show Amount unavailable. Existing foreign history retains native currency metadata; do not claim PHP conversion.
- Recorded totals are strings and may exceed Number.MAX_SAFE_INTEGER cents. Format independently with BigInt/string arithmetic, never Number aggregation. This task validates exact totals but deliberately adds no UI formatter.
- The hook's input and visible query identity are separate from the pending debounced read. Use queryKey to clear selection after applied query changes, then prune against surviving eligible IDs after refresh.
- Preserve existing command owner guards and refresh-only retry receipt before awaiting hook.refresh(). Remove the old raw list loader only after page callers migrate.

## Verification

TDD RED: missing adapter import; missing options function; missing controller import. Additional RED regressions showed concurrent write refresh silently skipped, StrictMode replay stuck loading, and stale refresh falsely resolved; fixed request supersession/unmount invalidation/stale refresh rejection. Added RED exact recorded-total and creation metadata consistency assertions, then implemented exact checks.

Final focused run: **59/59** across 17 new adapter tests, 12 controller tests and 30 preserved history/detail/proof tests. Covers token pinning, archived/default/foreign-owner options, backend order, complete groups/matching IDs, huge exact totals beyond safe cents, malformed envelopes, unavailable legacy values, debounce invalidation, owner/error transitions, stale pages/refresh/unmount, failed load-more/retry, full-query preservation, replacement refresh with one capture and React StrictMode effect replay. `npx tsc --noEmit` exit 0. Targeted Next lint four owned files: no warnings/errors. Cached diff check exit 0. No full suite, browser, production SQL, push or deployment performed in this unit. Parent independently owns broader integration QA.

Sandbox Vitest dependency realpath EPERM required approved escalation for focused tests. Initial sandbox Next lint misdetected installed TypeScript and attempted dependency bootstrap; stopped it immediately, reran lint elevated against existing packages, and Git verified no package/lockfile changes.

Antislop scoped delivery gate: R-17/R-27 PASS, counts remain null until verified receipt and failures retain explicit error/retry state (controller tests). R-31 PASS, the sole source comment explains the legacy empty-date contract; no decorative or restating comments. No UI/design/assets changed, so visual gates remain Task 4/5/6 responsibility.

## Scoped review repair

Review `task-3-review.md` identified canonical metadata validation that only proved a supplied creation pair belonged to any child and only checked civil-date syntax. Reproduced RED with three new focused tests (older creation pair, tied ID/unrelated civil date, microsecond creation order and purchase-date/fallback invariants), then repaired in commit `f0d792c fix(transactions): verify canonical history sort metadata`. Only adapter and adapter tests changed; hook API and detail/proof behavior unchanged.

Creation metadata now matches the true maximum child creation instant and greatest UUID among ties. Instant comparison retains PostgreSQL microseconds and accounts for timezone offsets; it does not truncate through JavaScript millisecond comparison. Equivalent canonical UTC timestamp strings are accepted.

Non-null transactionDate must equal consistent non-null group purchase date, otherwise the latest complete-child due date only when every due date is available; ordinary entries use their due date. Fully known, consistent purchase metadata cannot be replaced with a fallback or unknown date. Fully known inconsistent purchases use due-date fallback. Unknown due-date fallback stays null.

Legacy ambiguity retained deliberately: RPC hydration maps BOTH absent purchase dates AND malformed/nonfinite/out-of-range original purchase dates to null. Task2 SQL deliberately emits canonical transactionDate=null for malformed purchase metadata even when due dates are valid. Therefore when at least one hydrated purchase_date is null, the adapter allows canonical null as well as a defensible due-date fallback; it cannot distinguish the underlying cases from this DTO. Unrelated non-null dates remain rejected. This prevents overconstraining valid legacy envelopes or inventing a guessed date. No schema/backend change was made.

Final verification after repair: 62/62 focused tests (20 adapter,12 controller,30 preserved history/detail/proof), tsc exit0, targeted lint clean, diff/cached diff checks clean. Source comment gate PASS: the added one-line comment records this lossy hydration constraint. Broader suites, browser and production actions remain deferred to parent integration.
