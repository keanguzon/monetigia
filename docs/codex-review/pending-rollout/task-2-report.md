# Task 2: Overspend confirmation popup

Implemented the scoped presentation changes in `GoalReleaseDialog.tsx`, `GoalReleaseNotice.tsx`, `AddTransactionModal.tsx`, and `tests/transaction-release.test.tsx`. No hooks, financial contracts, refresh controller, SQL, dependencies or assets changed. No commit, push or financial data write was performed by the executor.

The required release review now opens in a separate, opaque Radix dialog with its own title and body portal. Keep reservations receives initial focus. Its scrollable quote/customization content sits above fixed actions with safe-area padding. The original transaction footer remains separate and fixed. The existing green, typography, light/dark surfaces and 44px controls are retained without added motion.

The parent consumes only the existing submission controller. Its presentation latch retains the displayed quote through custom/stale requotes and saves; callbacks always use current controller methods and authoritative draft. Current phase directly disables popup actions, custom inputs and dismissal. Fresh stale quotes, including zero releases, require renewed explicit confirmation. Ordinary initial zero-release quotes still save directly through the unchanged hook.

Unknown outcomes close review and focus the existing parent Retry same transaction button. The existing recovery request UUID, command and quote survive closure/reopening. Known rejection/custom quote failure restore the preserved form and one reachable parent error. Refresh failure remains committed with no resubmission. Successful refresh uses the existing parent close effect alone.

## Verification

- RED: initial new popup tests failed 6 cases while all 27 original tests passed; failure was the missing separately named dialog.
- GREEN: `npx vitest run tests/transaction-release.test.tsx` — 36 tests passed, exit 0 (latest run at 13:38:56, 2026-10-08).
- `npx tsc --noEmit` — exit 0, no diagnostics.
- `git diff --check` — exit 0, no whitespace errors. Git reports only configured LF/CRLF conversion notices.
- Coverage includes named popup/fixture amounts; initial focus; Tab/Shift+Tab; parent inert/accessibility hiding; Keep/Escape/outside zero writes; deferred double confirmation and non-dismissability; refresh-gated single auto-close; deferred stale requote/new PHP 4,000 server quote; stale fresh zero-release confirmation; deferred exact customization and disabled unreviewed inputs; failed custom quote; preserved fields/scroll; unknown focused retry and original UUID/command/quote; known rejection focus; existing auth/session and refresh-failure regressions.
- Browser finding from root: installed Radix dialogs do not emit `aria-modal="true"`, so navigation initially remained visible behind their overlays. Added the existing `data-mobile-nav-blocking` marker to both scoped Dialog.Content elements. A new assertion failed before this fix and passes afterward. Root owns final navigation/browser acceptance.
- Review correction: a stale fresh zero-release quote previously still offered customization when multiple goals were eligible. That path could requote an empty release list and invoke the unchanged hook's ordinary zero-release auto-save. Zero-release review now suppresses customization entirely. The multiple-eligible stale-zero assertion failed before the fix and passes afterward; no write occurs until renewed explicit confirmation.
- Browser correction: accepting unchanged custom amounts can return identical quote JSON/fingerprint. Content-only notice keys then left confirmation disabled in custom mode. The wrapper now increments a presentation-only revision after a busy review cycle completes, resetting notice UI even when server content is identical. Deferred identical-quote regression failed before the fix and now verifies disabled confirmation while quoting, no early write, restored explicit confirmation, and the authoritative server quote supplied to save.

## Authorized ruling and review limits

Installed Radix switches between distinct `DialogContentModal` and `DialogContentNonModal` components when `modal={!reviewOpen}` changes. That remounts the parent form DOM, contradicting the brief's literal stays-mounted claim. Root explicitly ruled to retain the mandated modal switch while preserving draft state in the parent and explicitly capturing/restoring the form scroll position. No controller reset is introduced when review opens. The scroll regression passes. This is a documented DOM-mount exception, not a claim that the DOM stays mounted.

Parent inert/aria-hidden removal and focus restoration account for Radix's deferred scope cleanup. Root observed the 375px popup, initial Keep focus and Escape returning to Add Transaction with entered PHP 9,500 and submit-button focus; it also observed navigation hidden after the marker fix and 768/1280px layouts without overflow. Broader light/dark, long custom rows, reduced motion and keyboard checks remain root-owned. Physical Safari/virtual-keyboard acceptance remains device-dependent.

## Antislop evidence

During mode and existing ENERGY 1 / RHYTHM 2 / MOTION 1 direction are inherited from the resolved session. Solid dialog surfaces distinguish the active financial decision; higher stacking and a body portal isolate its focus; fixed footer actions remain reachable as goal content grows. Copy names reservation releases and explicitly distinguishes them from goal spending; a stale zero-release quote uses truthful updated-amount wording. Existing green and typography provide continuity. No decorative assets, animation, duplicated heading or duplicate controller-error announcement were added. Browser craftsmanship gates and independent review remain root-owned.

## Root final Task 2 checks

Root reran36focusedtests and standaloneTypeScript: both exit0. Live375light/dark popup showed true quote Cash10000/reserved1500/available8500;9500expense proposed Phone500+DebtGoal500. InitialKeepfocus, Escape retained9500 and returnedSubmitfocus. Navhiddenobserved afterbothmarkers. Customidentical500/500requote now returns enabledexplicitConfirm; noConfirmsaveclicked.768/1280dialogwidth512 nohorizontaloverflow. Temporaryforms canceled/tabsclosed, originalDarkrestored. PhysicalSafari/virtualkeyboard/reducedmotion/long-namecases remain unverified; current2goalcustomrows fit. Review spec/qualitypassed aftertwofindingsfixed.
