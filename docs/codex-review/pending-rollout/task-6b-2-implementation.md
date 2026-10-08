# Task 6b.2 implementation handoff

Owned files: `src/components/accounts/AddAccountModal.tsx`, `src/components/forms/AddAccountForm.tsx`, `tests/debt-account-create-ui.test.tsx`.

Both modal preset/custom credit paths and standalone credit now consume reviewed `useDebtAccountCreate` from `src/hooks/use-debt.ts`. The account input contains exactly the nine reviewed fields; custom empty icon maps to null, credit defaults to exclude net worth, and None sends an empty debt array. Ordinary creation still inserts directly with its existing account fields and balance semantics. Hidden debt values never enter an ordinary insertion.

The modal uses the installed Radix Dialog directly, with labelled content, focus return, Escape/background dismissal, retained mobile navigation blocker, fixed header, bounded scrolling middle and nonshrinking native-form footer. Footer has safe-area padding, 44px controls, and a readable local dark primary foreground. The repeated category markup is consolidated without adding a new product surface or assets; wallet options and categories remain.

Recovery consumes the hook's readonly pendingInput, restoring its account identity and named debt rows after actual unmount/reopen. Saving/unconfirmed/saved recovery disables editing. Unknown outcome offers only the existing same-attempt retry. Closing does not reset the controller. Known rejection preserves the editable draft. Saved refresh failure offers refresh-only recovery; routing/closing occurs after successful refresh. A synchronous submission guard prevents Enter/immediate repeated submission from issuing a second creation.

## Evidence

- RED: `npx vitest run tests/debt-account-create-ui.test.tsx tests/existing-debt.test.tsx` at 21:47 local, exit 1: 10 UI tests failed because creation/recovery/accessibility behavior was absent; 28 field tests passed. Initial selectors were corrected for pre-existing accessible names before the confirmed RED run.
- Additional targeted RED: rejected modal transition lost the debt draft; frozen standalone restoration selected a new icon despite original null. Both regression tests failed before their fixes.
- GREEN: at 21:55 local, `npx vitest run tests/debt-account-create-ui.test.tsx tests/existing-debt.test.tsx tests/debt-hooks.test.tsx tests/transaction-release.test.tsx --reporter=dot`, exit 0: 4 files, 99 tests passed (creation UI 17 tests).
- Required five-file run at 21:54: 112 passed, 2 failed. Both failures were `tests/wallet-reservations.test.tsx` cases `newer debt refresh survives an older response (old failure: false)` and `(old failure: true)`: they expected old transaction-derived `-₱300.00` during the concurrent Task 6a.3 migration to snapshot presentation. Root/6a.3 were notified; this agent did not edit that shared test file.
- Latest `npx tsc --noEmit`, exit 1: only concurrent 6a.3 errors remain: `accounts/page.tsx(499,9)` unknown ReactNode and `LegacyDebtReviewDialog.tsx(60,214)` undefined string. Neither owned creation component has a type error.
- Root coordinates the fresh integrated required run and full `npm test` after both source units freeze; no full-suite completion claim is made here.

## Coverage and remaining acceptance

Creation tests mount actual components while mocking external auth/router and the real reviewed hook boundary. They check exact None/custom scheduled payloads, multiple independent debts, no direct credit insert, ordinary insertion and type-switch isolation, invalid debt preventing partial save, frozen readonly restoration including nullable icon, rejection draft preservation, signed-out feedback, retry-only/refresh-only recovery, actual unmount/reopen, duplicate Enter submit, native footer form linkage, Radix focus containment/Escape/focus return and cancellation without writes. Controller request UUID survival and stale-auth behavior remain covered by the passing reviewed hook tests.

No SQL, financial hooks, shared debt fields, other agent files, asset generation, installs, commits, pushes or production operations were changed. Source checks preserve green/Manrope/Bricolage ENERGY1/RHYTHM2/MOTION1 and compact form purpose. Actual rendered antislop gates/browser acceptance are delegated to root as requested: 320/375/768/1280, themes, long/600-row form, keyboard viewport, zoom/reduced motion and touch/safe-area checks. Physical iOS acceptance and migration installation remain pending until independently observed.

Review is requested through root for this frozen working-tree unit against HEAD fc0560d. No nested review agent was spawned because the task explicitly forbids nested agents.

## Browser follow-up fixes and refreshed evidence

Root observed light Create Wallet text contrast 3.00:1 and Escape returning focus to BODY. Both local primary buttons now use `text-green-950` in both themes; no global theme changes. Installed antislop-human checker: #052e16 on #16a34a = 4.52:1; on #22c55e = 6.54:1. The existing 90% primary hover composite measures 5.09:1 light over white and 5.56:1 dark over slate800. Root will confirm computed browser colors including hover.

The modal captures the active opener synchronously on its closed-to-open render, before Radix/other layout effects can move focus, and uses the captured connected element for close autofocus. A new regression reproduced wrong focus return when an opening layout effect changes focus: RED 1 failed/17 passed, then GREEN after moving the capture. The standalone known rejection test now preserves and asserts both submitted wallet name and debt name across saving/rejected rerenders instead of remounting an empty editable form.

Latest focused verification at 22:15 local: `npx vitest run tests/debt-account-create-ui.test.tsx tests/existing-debt.test.tsx --reporter=dot`, exit0: 46/46 tests (18 creation UI,28 shared field). Fresh `npx tsc --noEmit` exit0. Source refrozen; root owns rendered browser retest and integrated full suite.
