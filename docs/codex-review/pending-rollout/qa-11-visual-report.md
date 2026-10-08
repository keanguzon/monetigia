# QA 11 visual corrections report

## Changes

- Mobile navigation now uses a five-column equal grid at every mobile width. Route labels are absent from the visual DOM; links retain their `aria-label` names. Destination icons are 24px, the active destination icon retains the primary green token, and the shared neutral indicator uses the same inset in each equal slot. Existing glass themes, navigation motion, reduced motion, focus styling, and 44px minimum controls remain in place.
- Delayed and failed mobile recovery now use a centered, borderless, transparent icon action followed by short status copy. The 40px refresh glyph is decorative to assistive technology; its 48px semantic button is named `Refresh ${label}` and retains the existing refresh, disabled/busy, focus, and live-announcement behavior. Delayed copy says “Taking longer than expected. Try refreshing.” Failed copy says “Can't load page” and “Please try again.”
- Recovery height uses the current measured navigation reservation and safe-area inset with viewport-height fallback/dynamic viewport sizing; the content can grow rather than being clipped or placed in another fixed viewport layer. Loading skeletons, route handling, provider timers, and suppression behavior were not changed.
- Updated the QA-11 brief to replace the earlier visible-label and 320px two-row decisions with the latest icon-only, equal single-row requirement.

## Verification

- Test-first RED: the revised focused assertions failed on visible route-label spans and the previous delayed/failed copy. After implementation, `npx vitest run tests/mobile-navigation.test.tsx tests/mobile-navigation-recovery.test.tsx tests/mobile-navigation-visibility.test.tsx tests/sidebar-breakpoint.test.tsx` passed: 4 files, 24 tests.
- Root's live browser measurement at 320px, 375px, and 412px showed five equal slots (58.19px, 69.19px, and 76.60px respectively, within 0.02px), 66px surface height, 24px icons, no visible label text, and no horizontal overflow. Root reviewed both light and dark glass appearance.
- Root reports `npx tsc --noEmit` and the production build exited 0; the build had five existing hook warnings. The Sol scoped rereview found no P1/P2 defects.
- Recovery screenshot verification remains pending: root could not force delayed/failed state in the available CUA browser. The recovery states are covered by focused component/integration tests, but those tests do not certify live visual centering or assistive-technology announcement timing.
- PostCSS parsed `src/app/globals.css`; `git diff --check` passed for the scoped files.

## Limits

The nav's accessible route names are supplied by `aria-label`; there are no visible nav captions by user request. The light selected icon uses the required primary green; the opaque icon-to-muted token ratio is 3.0066:1, just above the 3:1 non-text threshold. The supported translucent fill varies with the underlying surface, so final per-pixel contrast is not claimed. No full Apple material/refraction is claimed. This pass did not verify recovery in a live browser, dynamic text enlargement, or physical Safari/iOS.

## Root QA 11 verification

- Latest user override: mobile navigation icons only, all five slots equal in a single row at every mobile width. The former visible-label/two-row narrow proposal is superseded.
- Fresh root production build (.next-verification): exit 0, all 20 pages generated. Five existing hook-dependency warnings, outdated Browserslist notice, and initial edge compiler SIGTERM notice remain; compilation and build completed successfully.
- Fresh standalone TypeScript check: exit 0. Four focused mobile suites: 24/24 passed.
- Root observed icon-only navigation at 320/375/412px with equal controls within 0.02px, minimum measured width 58.19px, height 66px, 24px icons, no horizontal overflow. Light and dark screenshots checked; original dark theme restored and temporary browser tab closed.
- Live slow-network recovery composition still needs user QA; component checks validate short delayed/failed copy, accessible refresh action, and busy behavior. No deployment or production-data change in this correction.
