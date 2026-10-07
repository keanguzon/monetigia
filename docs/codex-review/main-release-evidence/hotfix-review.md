# Resumed two-hotfix review, 2026-10-08

antislop active: during (session override).

Reviewed committed HEAD `f22336469fe4c59615d9a48a0d1a55430e80d10d` against `cebe57f28968417146deed2732d2b46fd0ecb255`. Source review was read-only; this requested report is the only file added by the reviewer. Scope: debt summary and visible transaction feedback in accounts/page.tsx, AddTransactionModal.tsx, wallet-reservations.test.tsx, and transaction-release.test.tsx.

## Previous findings

1. **Resolved: blank balance coercion.** `src/app/(dashboard)/accounts/page.tsx:467-477` now accepts finite numbers or trimmed decimal strings only. Missing, null, empty, whitespace, malformed, unsupported types, NaN, and infinities fail the gate; unsafe positive cent totals also fail. `:499`, `:610`, `:626`, and `:687` propagate this error to unavailable debt, hidden deduction caption, and disabled deduction. The parameterized tests at `tests/wallet-reservations.test.tsx:372` cover missing, null, whitespace, and malformed strings. Explicit empty-string/nonfinite cases and invalid-after-valid active-preview tests are absent, a remaining coverage recommendation rather than a demonstrated defect.

2. **Resolved: stale deduction annotation during loading.** `src/app/(dashboard)/accounts/page.tsx:497-499` includes account revalidation and local account/debt loading; `:551-554` stops applying the preview amount while debt is pending/unavailable; `:610-614` hides the annotation while either summary is loading or in error. `loadAccounts` sets loading before its first await at `:258-264`. Existing deferred/race tests at `tests/wallet-reservations.test.tsx:176-247` pass, but none first activates the deduction and then asserts caption removal through a deferred refresh. That precise regression test remains recommended.

3. **Resolved in source and DOM tests: retry inside capped alert.** `src/components/transactions/AddTransactionModal.tsx:612-623` now caps only alert text and saved status. Retry is an unscrolled sibling of the alert container, outside the body scroller, above the footer, with a native button and `disabled={isLoading}`. The source retains the native `form onSubmit` at `:318` and submit button at `:634-639`. `tests/transaction-release.test.tsx:271-284` confirms a single alert, alert/retry outside the body, retry outside the alert parent, and the same financial request after reopening. Actual 375x667 bounds, keyboard activation and appearance during retry were not measured by this reviewer; root owns that live verification.

4. **Resolved: outdated wallet assertions.** `tests/wallet-reservations.test.tsx:217` now expects authoritative credit debt of 8000 after the schedule race. `:324-336` handles both tile and summary matches, explicitly checks Outstanding Debt at 8000, and expects All months preview 22000 while preserving selected-month preview 29300. New cases at `:339-370` verify account balance 6600 independently of schedule totals, selected-month Scheduled Debt of 700, and opening debt with no schedule remaining deductible.

## Strengths and additional findings

- All months uses the sum of positive current credit balances at `src/app/(dashboard)/accounts/page.tsx:463-482`, while selected-month calculations preserve their historical schedule at `:545-549` and use a Scheduled Debt label at `:624`.
- Quote/save errors and saved-refresh guidance are outside the body scroller. Rejected save cancellation clears the error without another write (`tests/transaction-release.test.tsx:302-327`); quote insufficiency writes nothing (`:330-341`); a saved refresh failure cannot save again (`:287-299`).
- No new blocking source defect was found within this bounded scope. The missing precise regression cases above are coverage recommendations, and browser geometry remains unverified here.

## Fresh verification

Command: `npx vitest run tests/wallet-reservations.test.tsx tests/transaction-release.test.tsx tests/contributions.test.tsx`

Exit code **0**. **3 test files passed; 56 tests passed** (wallet reservations 18, transaction release 27, contributions 11). Reported duration 32.79 seconds. The checkout was clean before review and after the test run, before adding this report.

## Declined to judge

- Landing refresh: separate user request, outside this review.
- Larger debt plan and financial RPC architecture: outside the two-hotfix scope.
- Existing GoalReleaseNotice review content inside the body: unchanged; this review covers quote errors, save feedback, unknown retry and saved refresh guidance.
- Whole-branch typecheck/build, merge readiness, and main integration: root owns these checks.
- Live mobile bounds, keyboard activation, zoom, both-theme contrast and complete app click-through: not exercised by this source/test reviewer. No full antislop design delivery gate pass is claimed.

## Assessment

**Bounded hotfix verdict: approved.** The four earlier source/test findings are resolved and the focused suite passes. This is not a whole-branch readiness verdict; final mobile verification and broader integration checks remain with root.
