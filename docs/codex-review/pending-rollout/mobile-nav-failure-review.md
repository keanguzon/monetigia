# Mobile navigation recovery review

antislop active: during (session override).

Reviewed the actual working-tree implementation against `mobile-nav-failure-brief.md` on 2026-10-08. This pass writes only this report. No product fixes, commits, pushes, database commands, or financial writes were performed. Concurrent optical navigation changes and sidebar test-mock changes are excluded.

## Verdict and priority findings

No concrete P0, P1, or P2 defect was found in the reviewed provider, link, mobile navigation, recovery, dashboard wrapper, or recovery CSS. The source and focused DOM tests support the requested behavior. This is code-review approval within that scope, not completed browser/device or financial-session acceptance.

No lower-priority source defect is reported merely because a test or browser observation is absent. The specific evidence gaps are listed below.

## Behavior checked

- `navigation-provider.tsx:77` starts mobile request state outside the routing transition, records a monotonic ID in a synchronous ref, and resets the previous watchdog. The timeout checks the current ID before retaining a delayed request. A synchronous push exception only fails its still-current request. General navigation clears mobile intent and retains the existing shared pending/watchdog contract.
- `navigation-provider.tsx:67` clears recovery only when the committed pathname matches the latest requested destination. Older commits do not discard the latest request; a matching late arrival clears delayed feedback. Query/hash handling intentionally follows the brief's pathname arrival contract.
- `navigation-link.tsx` strips `navigationSource` before spreading Link props and invokes the existing `navigationDestination` guard before creating mobile intent. Modified, nonprimary, cancelled, external, download, target, and current-URL rules remain centralized in the unchanged navigation helper.
- `mobile-navigation.tsx:114` keeps `aria-current="page"` tied to committed pathname while requested destination drives visual selection. Loading uses `aria-busy`, a requested-destination description, and one mobile live loading status instead of duplicating the existing per-link loading status. Delayed selection remains active and stops being busy. All five current destinations and glyphs remain.
- Recovery uses neutral existing Skeleton primitives, a requested-page heading, and no fabricated values or controls while loading. At the watchdog threshold the skeleton yields to the required heading, honest slow-arrival sentence, destination label, and visible **Try to refresh** action. Failed state omits only the optional delayed-arrival sentence. No effect automatically refreshes or retries.
- `navigation-provider.tsx:114` captures the latest request, rejects loading/double activation, validates origin and the five allowed destination paths, preserves approved query/hash, and calls the injectable document-navigation boundary. Its production default is `window.location.assign`, rather than `router.refresh` or another cached SPA push. A synchronous assignment exception releases the activation guard.
- `dashboard-layout-client.tsx:27` applies hidden/aria-hidden/inert only on mobile with unsuppressed recovery. The children stay mounted in a stable wrapper. Desktop exposes current route content normally; unresolved intent survives a breakpoint roundtrip. The content-local modal scan ignores the recovery wrapper's own hiding so an inline modal opening during a pending request can restore its ancestor. Existing modal/keyboard suppression also restores the active form and suppresses the placeholder.
- `navigation-provider.tsx:134` cancels intent on popstate and removes that listener, cancels its timer, and invalidates outstanding IDs on unmount. Settings in the actual Header calls provider `navigate("/settings")`, so that explicit account-menu navigation supersedes mobile intent.
- Recovery CSS uses an opaque themed feedback surface, wrapping text, an explicit focus-visible outline, and at least 44px button dimensions. Its display rules are confined below 1024px. The Skeleton primitive already includes reduced-motion suppression. No focus call runs when the watchdog fires.

## Fresh verification

All commands were rerun by this reviewer against the current shared working tree:

| Command | Observed result |
| --- | --- |
| `npx vitest run tests/navigation.test.tsx tests/mobile-navigation.test.tsx tests/mobile-navigation-recovery.test.tsx` | Exit 0; 3 files, 27 tests passed |
| `node --test tests/navigation-goals.test.cjs` | Exit 0; 2 tests passed |
| `npx tsc --noEmit` | Exit 0; no diagnostics |

The earlier executor's reported full 242 Vitest plus 7 Node passes were not independently rerun here and are not used as fresh evidence. This reviewer did not perform a RED run against a reverted implementation.

Focused evidence covers immediate requested selection versus committed current-page semantics, 7999/8000ms behavior, stale timers, older late commits, late matching arrival, latest-request synchronous failure, old-request synchronous failure, general navigation replacement, popstate/cleanup, modified/cancelled clicks, query/hash refresh targeting, URL-policy rejection, double activation, Enter activation, desktop roundtrip, an inline modal opening while pending, keyboard suppression, and mounted draft preservation. Existing suspended general-navigation and indeterminate LoadingBar assertions still pass.

## Financial recovery implications

Source inspection confirms that neither recovery nor the navigation provider imports or calls financial apply, quote, reset, or transaction-submit APIs. The document refresh is an explicit button action with no automatic replay. The modal tests use a local dummy form; they do not simulate a real pending financial command.

The current financial recovery contract is document-lifetime state. `src/hooks/use-transaction-submit.ts:15` stores transaction controllers in a module-level Map, including the attempt UUID, command and quote. Lines 76-86 reuse that attempt while retrying within the document; `reset` at line 51 refuses to discard a pending attempt. Deletion controllers similarly live in the module-level Map at line 108. A full `location.assign` destroys those Maps and any unsaved form draft. Keeping children mounted protects state while recovery is shown, but does not preserve it across the user's full refresh.

The existing server operation registry is unchanged: `supabase/migrations/202610060002_goal_allocation_ledger.sql:32` enforces the user/request UUID identity. That only protects a retry with the same UUID and does not establish that the browser remembers an unknown outcome after reload. Do not claim that unknown-outcome recovery or a draft survives this refresh. This limitation matches the approved brief; no persistence/controller rewrite was attempted.

Root still needs to record actual financial-session acceptance: recovery must remain suppressed while a real financial dialog is open, returning after dismissal without automatically quoting, applying, resetting, or replaying a command. Use existing mocks or an authorized disposable test environment; this review did not write financial data.

## Unverified acceptance and test limits

- Real Next App Router slow/offline navigation, immediate selection before suspended mobile content commits, rapid tabs, older/latest arrival, selected-route document refresh, current links and real Back/Forward need browser observation. The mobile recovery integration suite mocks push and manually publishes pathname changes; the suspended test exercises general navigation rather than recovery together with a real App Router transition.
- Screen-reader announcement timing, initial insertion of the delayed status region, focus reachability after timeout, and absence of duplicate audible announcements need browser/assistive-technology observation. DOM roles alone do not certify announcements.
- Rendered 320/375px layout, 200% text zoom, both themes, refresh-button/focus contrast, overflow, safe-area clearance, and physical keyboard/device behavior have not been observed in this review. CSS declarations are not pixel or device acceptance.
- Desktop tests prove actual content remains accessible through a breakpoint roundtrip. Recovery tests mock Sidebar and Header; the real Settings wiring was read, but a browser check of committed desktop sidebar feedback remains required.
- Current tests do not directly assert failed-state recovery copy, retrying a delayed selected link, a synchronous document-assignment exception allowing a subsequent retry, or a true pending transaction/controller across modal dismissal. Those are coverage limits rather than reproduced defects.
- Watchdog expiry establishes delayed arrival, not a definitive network failure. A matching pathname does not certify successful page data loading. Existing page-specific errors remain responsible for post-commit data failures.

## Scoped antislop gate

- PASS, R-26/R-27: skeleton, delayed/failed feedback and refresh behavior exist; focused tests exercise the timeout and explicit refresh action.
- PASS, R-23/R-36: no new visual assets, invented financial values, progress percentages, or definitive asynchronous-failure claims appear in recovery.
- PASS, R-32 source/DOM: native button, visible focus rule, Enter activation, mounted-modal usability, and mobile hidden/inert policy are checked in source and focused tests.
- PASS, purpose and existing direction: recovery is an opaque semantic surface with existing tokens/typography; RefreshCw names the requested refresh action and skeleton motion indicates loading with reduced-motion suppression.
- UNVERIFIED, R-03/R-25/R-34/R-35: narrow layout, text zoom, rendered contrast, themes, and complete browser click-through remain acceptance work. No complete visual delivery gate is claimed by this code review.

## Final scoped rereview addendum

Re-read the final mobile navigation geometry, optical preference/fallback rules, and provider cleanup refactor after root's browser acceptance pass. No new P1 or P2 issue was found in those changes. This addendum updates the earlier evidence limits; browser observations below were reported by root, not observed by this reviewer.

The surface now uses natural flex wrapping with `flex: 1 0 max-content` controls, 44px minimum dimensions, 12px text, and unbroken labels. Below 421px, 4px outer insets, 2px surface padding, zero gaps and zero inline control padding recover space without renaming destinations or shrinking text. At a width that cannot fit all five intrinsic labels, entire controls move to another row rather than leaving orphan final letters. Existing ResizeObserver height measurement provides clearance for the resulting nav height. This is a natural fallback, not a forced 320px three/two arrangement. Actual larger-text wrapping, expanded surface shape, bottom clearance and content reachability remain unverified.

Root reports these local-browser results: at a 320px viewport with classic scrollbar and 305px client width, every active destination state fits one row without overflow, each target remains at least 44px, and nav height is 72px. At 375px both themes show complete labels without orphan letters. Add Goal hides navigation and cancellation restores it; sort-menu Escape restores focus; at 1280px the native select remains and desktop collapse state survives a mobile breakpoint roundtrip. Root also previously reported a real normal Transactions tap showing its skeleton while the URL was still `/dashboard`, followed by the committed route. These observations narrow the earlier browser gaps but do not establish slow/offline timeout recovery, real refresh targeting, screen-reader announcements, larger text, or physical Safari acceptance.

The optical rules retain primary-green active glyph/text, a dark neutral active surface in light theme, and theme-appropriate dark neutral in dark theme. The rim pseudo-element has no background that could veil the page; its purpose is border/shadow treatment. Without backdrop-filter support the base opaque surface remains. Reduced transparency and higher contrast remove filtering and use opaque fills; forced colors uses Canvas/CanvasText and keeps a visible selected boundary and focus outline. Token calculations for the explicit opaque selected states give text contrast 4.73:1 light default, 4.67:1 light higher-contrast, 6.41:1 dark default and 5.91:1 dark higher-contrast. These are calculations from declared colors, not measurements of a translucent rendered underlay.

The effect-local `invalidateLatestIntent()` only increments the same intent ref previously incremented inline. Both popstate and cleanup call it before clearing the timer/request. It retains the ID guard semantics and does not capture a stale numeric ID or change routing behavior. This reviewer did not repeat the focused or full suite for this addendum; Luna owns the final focused checks. Root reports the current full suite passed 249 Vitest plus 7 Node tests; build was still pending when this addendum was written.

Larger-text natural wrapping and physical Safari/Home Screen keyboard/safe-area behavior remain explicit acceptance limits. The document-refresh financial-state limitation above remains unchanged.

## QA 11 icons-only and centered recovery rereview

Reviewed the final QA-11 brief, executor report, mobile navigation markup, recovery markup and associated CSS after implementation readiness. No new P1 or P2 finding was identified. The latest user's icons-only navigation and centered recovery instructions supersede the earlier visible-label, natural-wrapping and boxed-feedback descriptions in this report.

Navigation now has five equal `minmax(44px, 1fr)` tracks at every mobile width. Visible label spans are removed, while the existing route-specific `aria-label`, committed `aria-current`, requested description and loading semantics remain. All glyphs are decorative 24px SVGs. Active-state weight cannot resize a track; every indicator uses the same inset. Reduced motion, glass fallback, preference rules and desktop hiding remain. The former narrow two-row or whole-label wrapping acceptance no longer applies.

Recovery preserves loading skeletons and suppression, but delayed/failed feedback becomes centered content with a transparent 48px button containing a decorative 40px RefreshCw. The button is named for the selected destination, remains disabled and busy during refresh, and keeps focus-visible and refreshing live status. Delayed copy now says “Taking longer than expected. Try refreshing.” without a definitive failed heading; synchronous failed state uses “Can't load page” and “Please try again.” The latest copy replaces the earlier required visible “Try to refresh” action text. No additional routing, timers, financial actions or automatic retries were introduced. Viewport-relative minimum height subtracts header, top padding, measured nav reservation and safe area; content can grow rather than being clipped by a fixed overlay.

The updated light opaque selected fill is now `--muted`, not the prior dark neutral. Its required primary-green glyph computes to 3.0066:1 against the declared opaque light muted token, just above the 3:1 non-text threshold. The previous 4.73/4.67 text-contrast calculations therefore do not describe the current light selected surface. There is no visible nav text requiring 4.5:1. Translucent rendered-underlay contrast remains unverified; forced colors still supplies system colors and a selected boundary.

Root reports final browser measurements at 320/375/412px: five equal widths within 0.02px, controls 66px high, 24px icons, no horizontal overflow, and reviewed light/dark appearance. These are root's observations, not this reviewer's. The executor reports 24 focused tests passing across navigation/recovery/visibility/sidebar suites and successful CSS parse/diff checks. Root separately reports TypeScript with no output and production build exit 0 with five existing hook warnings. No duplicate suite or build was run by this reviewer.

Actual delayed/failed recovery screenshots in the live browser remain pending because root could not force those states through the available CUA surface. Component/integration tests establish markup and action behavior but do not certify visual centering, enlarged recovery text, announcements or per-pixel contrast. Physical Safari/Home Screen keyboard/safe-area acceptance and the financial document-reload limitations remain open as previously recorded.
