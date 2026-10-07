# Settings and responsive controls verification — October 7, 2026

Branch: codex/goal-reservations. Implementation follows the user's approved first-release Settings scope and subsequent theme, sidebar and transaction-footer fixes. Commit/push is authorized; beta integration and deployment remain separate.

## Changes

- Settings uses one divided surface with Profile, Appearance, Install Monetigia, Account and About/money rules. Existing Manrope/Bricolage typography and shared primary green match Goals.
- Profile has visible load/save/upload errors and retry, preserves edits on failure, validates authenticated returned-row updates and prevents concurrent save/upload. Avatar MIME/size/path match the existing API; no API or database migration changes.
- Light/Dark/System and the header toggle share one transition scheduler and next-themes preference. Latest selection wins; unmount ownership, reduced motion and no-op choices have regression coverage.
- Installation follows actual browser prompt/standalone availability. Accepting a prompt does not falsely claim installation. Sign-out reports failure before redirecting.
- The transaction dialog has a fixed header and footer inside its native form; only the middle scrolls. Status, quote review and recovery feedback remain accessible.
- Collapsed desktop navigation no longer becomes a narrow mobile rail. Crossing the 1024px boundary closes the drawer, mobile uses full-width labeled navigation, and desktop collapse preference survives. Closed mobile navigation is inert and hidden from accessibility.
- Browser zoom restrictions were removed. Financial command logic, reservations and QA data remain unchanged.

## Fresh integrated verification

Root ran checks sequentially against the final source, before documentation-only edits. Production output used .next-verification to protect the active preview.

| Check | Result | Evidence |
| --- | --- | --- |
| npm test | Exit 0; 192 Vitest + 7 Node tests | settings-evidence/final-tests.log |
| npx tsc --noEmit | Exit 0 | settings-evidence/final-tsc.log |
| npm run lint | Exit 0; five existing warnings | settings-evidence/final-lint.log |
| npm run build | Exit 0; 20 pages generated | settings-evidence/final-build.log |
| Independent spec/code review | PASS; no findings | settings-evidence/final-review.md |

Lint warnings: accounts/loadAccounts:83, categories/loadCategories:141, transactions/loadTransactions:59, AddAccountForm/icon:41, AddTransactionModal/loadData:80. Settings' former warning is gone.

The build emitted a nonfatal edge-server SIGTERM message and outdated Browserslist notices, then compiled/generated successfully and exited 0. Database checks were not rerun for this frontend-only batch; the prior installment report records 79 database assertions and 2 final-installed-state assertions. Those are prior evidence, not fresh Settings test results.

## Root browser evidence

Disposable localhost:3107 preview; no financial writes or fixture resets during these checks.

- Settings at 375px and 768px: no horizontal overflow. Desktop 1280px: client width and scroll width both 1265px.
- Light selection settled checked with the document's dark class absent; dark and System were exercised. Reload persistence and System following the browser preference were observed. Both callers now share the same timing.
- Desktop collapsed -> mobile: closed full 256px drawer, hidden/inert. Opening shows labeled mobile navigation. Returning to desktop keeps the 64px collapsed preference and removes hidden/inert state.
- At 375x667, scrolling the transaction form to Description leaves both footer buttons visible, one line, 46px high. Cancel bottom measured 617.65px, below the viewport boundary of 667px. Cancel closes without saving.
- Primary button text is slate-950: measured contrast 6.12:1 against light primary and 8.85:1 against dark primary.
- Screenshots: settings-desktop-light.jpg, settings-phone-dark.jpg, settings-modal-footer-phone.jpg.

Real profile upload/sign-out failure and success paths were verified through behavioral mocks, not a live production account. Native Safari installation, virtual keyboard and physical-device zoom remain manual device checks. No offline financial-write support is claimed.

## Design reasons and antislop delivery gate

The divided surface keeps related preferences together without repeating cards. Existing typography preserves product identity. Shared green communicates actionable controls; error red communicates failure. 44px controls and mobile stacking serve touch use. Theme transitions provide feedback without button bounce. ENERGY 1 / RHYTHM 2 / MOTION 1.

- Hard Gate PASS: implemented controls have actual handlers; install availability is truthful; mocks cover failed profile/auth writes without false success.
- Purpose Gate PASS: layout, color, typography, spacing and motion reasons are recorded above; no decorative glass or unrelated redesign was introduced.
- Liveliness PASS: existing heading typography, restrained primary accent and divided section rhythm match the approved dials.
- Craftsmanship PASS: fresh tests/typecheck/build, independent review, phone footer measurement, breakpoint sequence, contrast and overflow checks support delivery.

## Quick manual follow-up

1. Collapse the sidebar on desktop, shrink below 1024px: drawer should be closed. Open it: labels should appear. Return to desktop: previous collapse preference remains.
2. Switch Light/Dark/System in Settings, then use the header toggle: the same coordinated transition should apply.
3. Open Add Transaction on a narrow screen and scroll to Description: title and Cancel/Add Transaction stay visible. Cancel saves nothing.
4. On a real signed-in account, exercise profile photo/name save and sign-out. Check Add to Home Screen on a physical iPhone separately.

Deferred requests remain overspend popup, archived-goal Restore and glass mobile bottom navigation. Optional CSV export/hide amounts/account controls were not approved in this batch.
