# Installment history verification, October 7, 2026

Branch: `codex/goal-reservations`. This verifies the approved installment scope and earlier manual-QA fixes. It does not claim approval to merge or deploy. Latest user instruction is commit locally, manual QA, then push.

## Implemented behavior

- Purchase date defaults to local today. First payment due defaults one calendar month later, remains independently editable and resets on reopening.
- Due dates preserve the original anchor day through short months; previews and backend use exact centavo splitting.
- One expandable purchase group contains its remaining installment rows. Entire summary toggles; minimal chevron is at the right. Child details/deletion are independent controls.
- Date added is the default sort; Transaction date uses server-side purchase metadata with stable tie-breakers. Unknown legacy purchase dates remain visibly unknown, using latest remaining due date as the labeled fallback.
- Load more exposes older history in batches of 50 source rows. Selected groups hydrate their entire schedule with deduplication. Search/filter applies to loaded history, not an unbounded server search.
- Dropdown arrows have inset spacing. Transactions buttons have subtle pressed brightness without scale/bounce. Only the schedule body animates; reduced motion disables its transition. Collapsed content is inert and hidden from assistive technology.
- Goal actions use Reserve for Goal and Spend from Goal with the approved colors/order, Complete has an outline, and successful transaction saves close after successful refresh. Refresh failures retain recovery feedback.
- Apple touch icon is an actual 180px PNG; manifest assets are actual 192px and 512px PNGs based on the existing logo.

## Verification evidence

Final combined frontend verification ran after the subtle pressed cue and collapse-gap fix. Logs are retained under `docs/codex-review/installment-evidence/`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | Exit 0, 158 Vitest + 7 Node tests | release-tests.log |
| `npx tsc --noEmit` | Exit 0 | release-tsc.log, explicit exit status |
| `npm run lint` | Exit 0, six existing warnings | release-lint.log |
| `npm run build` | Exit 0, successful compile and 20 generated pages | release-build.log; isolated `.next-verification` output |
| `npm run test:db` | Exit 0, 79/79 PostgreSQL tests | final-db.log; run before final CSS-only refinements |
| Latest installed migration regression | Exit 0, 2/2 | final-backend-installed.log; latest RPC chain restored after older tests |

Six lint warnings: accounts/loadAccounts, categories/loadCategories, settings/loadProfile, transactions/loadTransactions, AddAccountForm/icon, AddTransactionModal/loadData. All are hook dependency warnings. The latest successful build also printed a nonfatal edge compiler SIGTERM message and an outdated Browserslist notice before completing successfully; it is not a warning-free build. Earlier build attempts had additional font/SSR/Webpack notices, which are not substituted for this final result.

## Root browser checks

On the disposable local environment at `http://localhost:3107/transactions`:

- Created QA Installment Acceptance with a purchase date separate from first due; confirmed one purchase group and three underlying installments, not an added duplicate purchase row.
- Observed the Jan31, Feb28, Mar31 schedule and PHP 1,000.01 split into 333.34, 333.34, 333.33.
- Successful save closed the modal. Individual deletion reduced remaining amount through 666.67 and 333.33, then removed the empty group. Temporary acceptance rows were cleaned up; existing QA rows retained.
- Observed default and alternate sorting, search/no-results and filters. Pagination/error retry and complete-group hydration are covered by focused automated fixtures; the live fixture is smaller than 50 rows.
- Whole-row click, Enter and Space toggled schedule. After the final gap fix, settled collapsed body measured **0px**, with `inert` and `aria-hidden`. During its 200ms transition an intermediate height is expected.
- Reviewed 375px, 768px, 1280px in both themes during this session, with no horizontal overflow. Final dark responsive recheck measured document widths 360, 768, 1280 respectively; final phone light layout was also inspected. Latest screenshot: `installment-phone-dark.jpg`.
- Local icon HTTP check confirmed metadata URLs, HTTP 200, PNG type and declared dimensions. Physical iOS installation has not been tested.

## Decisions and limitations

- Chosen debt-payment date determines its breakdown month. Independent historical billing attribution remains deferred; existing monthly validation still applies.
- Generated `history_date` supports exact server ordering; client-only sorting could not correctly order rows beyond page one.
- Legacy purchase metadata is not guessed from descriptions or due dates. The labeled fallback uses latest remaining due date to agree with server paging.
- Offset pagination is not a snapshot under concurrent external writes. Refresh after mutation resets loaded history; local deduplication does not claim snapshot isolation.
- Preview and build use separate output directories to avoid corrupting active dev assets. The preview database is local disposable data, not production.
- Apply the new migration after all six October 6 migrations. Production migration, beta merge, and deployment remain separate actions. Goal/RLS/idempotency guards are preserved.
- Settings, bottom glass navigation, archived-goal Restore, and popup overspend presentation remain documented follow-ups, not completed features.

## Manual QA checklist

Use the current local preview. Start by recording wallet actual/reserved/available and credit debt. Use fresh clearly named QA goals and descriptions; do not assume any old GCash balance or reset data.

1. **Dates:** Open Add Transaction. Ordinary transaction date should be local today. Enable credit installments; choose purchase Oct 6, 2026, verify first due Nov 6. Manually change first due, change amount/category, verify it stays unchanged. Cancel and reopen: defaults reset.
2. **Short month and cents:** Preview PHP 1,000.01 over three installments with first due Jan 31, 2027. Expect Jan31, Feb28, Mar31 and 333.34, 333.34, 333.33. Save once using a disposable credit account/test flow, then record the change from the baseline; no cash reservation should change.
3. **Grouping and deletion:** Find the new purchase group. Click its summary and use Enter/Space. Chevron stays right; body expands smoothly without button bounce. Open child details. Cancel deletion first, then delete one QA installment: only that child disappears and remaining scheduled amount falls by its amount. Do not delete unrelated fixture history.
4. **Sorting/history:** Check Date added and Transaction date. A newly added backdated purchase should rank differently. Two purchases with the same description must remain distinct. Search an installment child. If Load more is present, use it until older entries appear without duplicate groups. Mark live pagination untested if fewer than 50 source rows exist.
5. **Normal transactions and close:** Save a small QA income, expense, and transfer using wallets with sufficient actual/available funds. Selected date persists; success closes modal after refresh. Income must not inherit a goal tag. Clean up only your QA rows and check reversal deltas.
6. **Goal regression:** Fresh PHP 5,000 target, normal funded wallet: reserve 500, expect actual unchanged, reserved +500, available -500, goal 10%. Release reverses these deltas. Try another normal wallet such as GoTyme; credit/PayLater must not appear as a reservation source.
7. **Spend/lifecycle regression:** Reserve 3,000 for a fresh goal, spend 2,000 with that goal selected. Expect reserved 1,000, spent 2,000, combined progress 3,000. Delete while active to verify reversal. Repeat completion using a separate QA expense; completion handles leftovers explicitly. Delete that expense while completed: actual restores but goal stays completed and reserved stays zero.
8. **Overspend regression:** In a fresh wallet with actual 30,000 and only this QA goal reserving 5,000, enter ordinary expense 28,000. Review releases 3,000. Keep reservations saves nothing; confirmation saves once, leaving actual 2,000, reserved 2,000, available zero. Existing goals in another wallet are unaffected. Current notice is inline; popup is deferred.
9. **Credit/debt:** Tag a disposable installment purchase to a goal; verify informational tagging does not consume/reserve cash. Pay debt using a valid chosen-date month's breakdown and funded normal wallet; verify its actual payment date and single deduction. Invalid month/insufficient funds should show an error without a partial save.
10. **Accessibility/appearance:** Check 375/768/desktop, both themes, Tab focus, Enter/Space disclosure and Escape dialogs; collapsed children must not receive focus. Dropdown arrow inset, readable financial colors, subtle pressed feedback, no horizontal overflow. Enable reduced motion to confirm schedule movement stops.
11. **PWA/device:** On a reachable installed/deployed test site in Safari, Add to Home Screen and verify Monetigia logo. Remove/re-add an old shortcut if its cached icon persists. Local PNG validation does not replace this device check.

Record pass/fail and screenshots for failures. If a fixture/capability is absent, mark it not manually tested. Stop on incorrect accounting; do not continue altering data to hide a failure.

## Antislop delivery gate

- **Hard Gate PASS:** Changed controls have working actions and loading/error/empty states; root exercised purchase, grouping, details/deletion, sorting/filtering and keyboard disclosure. Both themes and target widths inspected; no added fake metrics, routes or assets. Primary/amount contrast checked and corrected.
- **Purpose Gate PASS:** Existing arrow icons identify financial direction; right chevron indicates disclosure. Bordered rows group real ledger content. Dropdown triangles communicate selection affordance. Schedule-only motion communicates expansion; button pressed brightness communicates input receipt.
- **Liveliness PASS:** ENERGY 1 / RHYTHM 2 / MOTION 1. Financial amounts and purchase title create hierarchy, spacing separates purchase and schedule, shared green emphasizes primary actions, existing Manrope/Bricolage and Monetigia logo preserve identity.
- **Craftsmanship PASS:** Production build and regression checks passed. Measured button text contrast is 6.13 light/8.86 dark; transfer amounts 6.70/7.87. Keyboard disclosure and zero collapsed height verified. Deferred work and device-only checks are explicitly separated from completed scope.
