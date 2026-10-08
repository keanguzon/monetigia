# Mobile navigation request and recovery brief

**Implementation recommendation:** Sol 6.1 medium, rather than Luna for routing state integration. Latest-intent concurrency, late commits and a refresh to a different requested URL need a coherent provider contract. Sol medium review. Planning uses Sol medium. No dependencies, financial-controller changes, write replay or desktop redesign.

Read current AGENTS.md, session antislop during core/UI/human/mobile/code rules, and actual files listed below. The current five mobile destinations are Dashboard, Transactions, Wallets, Goals, Categories; do not restore the superseded More arrangement.

## Latest requested behavior

Mobile highlight moves immediately to an ordinary tapped destination, before the route commits. If it cannot become available, keep that requested selection. On the page show a refresh icon/action with visible **Try to refresh**. The refresh action must request that selected destination, rather than refreshing the old page currently underneath. This latest action supersedes the earlier generic Retry-in-nav wording. Desktop sidebar selection/feedback remains based on the committed route.

While loading, replace the old page's mobile content with a requested-destination skeleton. At the existing 8000ms threshold replace that skeleton with the unavailable feedback and refresh action. The old page must not look like the selected destination or remain interactable on mobile. Keep it mounted underneath to avoid destroying local state; desktop still renders its current page normally. A late matching commit removes the placeholder/prompt and exposes the actual destination.

## Source evidence and limits

`navigation-provider.tsx` currently exposes pendingHref/navigate, tracks pathname and an 8000ms watchdog that clears destination. `LoadingBar` renders an indeterminate pulsing line while pendingHref exists. MobileNavigation currently highlights pathname only. NavigationLink uses `navigationDestination` to reject modified/defaultPrevented/external/same-URL clicks. No app error.tsx or loading.tsx boundary exists; Next App Router router.push returns void and supplies no dependable completion/failure promise. A watchdog therefore proves a delayed/unavailable arrival, not a network failure. A committed pathname also cannot prove all page data loaded successfully.

Keep the indeterminate bar and its existing desktop timing; no percentages or fabricated progress. Use honest slow-arrival wording with the requested refresh action. Definitive post-commit page data errors continue to use existing page-specific errors; adding a universal error boundary is outside this narrow change.

## Scoped files/interfaces

Modify `src/components/layout/navigation-provider.tsx`, `navigation-link.tsx`, `mobile-navigation.tsx`, `dashboard-layout-client.tsx`, and `src/app/globals.css` for scoped mobile recovery layout only. Create `src/components/layout/mobile-navigation-recovery.tsx` for the loading skeleton and unavailable prompt. Update `tests/navigation.test.tsx` and `tests/mobile-navigation.test.tsx`; create `tests/mobile-navigation-recovery.test.tsx` if provider integration tests are clearer separately. Preserve `src/lib/navigation.ts`, desktop Sidebar, LoadingBar, router query/history helpers, finance controllers and all financial requests. No Next error-boundary rewrite.

Extend existing provider backward compatibly:

```ts
type MobileNavigationRequest = {
  id: number; href: string;
  phase: 'loading'|'delayed'|'failed';
};
interface NavigationContextValue {
  pendingHref: string|null;
  navigate: (href: string, options?: { source?: 'mobile' }) => void;
  mobileRequest: MobileNavigationRequest|null;
  refreshMobileDestination: () => void;
}
```

Existing one-argument calls remain desktop/general behavior. Add optional `navigationSource?: 'mobile'` to NavigationLink's component props, remove it before spreading Next Link props, and pass it to navigate only after `navigationDestination` approves the click. MobileNavigation sets this prop on its five links. Do not optimistically select from raw onClick: modified/cancelled clicks must not change local selection. Existing mocks need compatible optional fields and callbacks.

Selection rule: mobile visual indicator/icon use `mobileRequest?.href` when it names a primary destination, otherwise committed pathname. Current-page semantics remain `aria-current="page"` on pathname only; requested link has an accessible requested/loading description and `aria-busy` during loading. Do not use aria-selected on anchors or claim requested page is current. A separate polite live status announces the requested destination; prevent duplicate loading announcements with the existing per-link status. Keep glyphs and existing reduced-motion indicator animation.

## State machine and exact semantics

- Ordinary mobile link intent starts a new monotonic request ID, stores requested href and loading state synchronously, supersedes previous mobile request/watchdog, then performs existing router.push in transition. New selected tab appears immediately. If navigate synchronously throws, mark only that still-current request failed; preserve selection and show refresh feedback. Do not claim this catch observes asynchronous router failures.
- At 8000ms without matching pathname, retain mobileRequest with phase delayed; continue existing pendingHref watchdog clearing for shared/desktop compatibility. Stop busy/loading status for that request and display recovery on the page. Copy: **Can't load page** followed by **This page is taking longer than expected. It may still open.** The icon button's visible label and accessible name are **Try to refresh**. Definitive synchronous failure may omit the slow-arrival sentence, but still retains selected destination. No error or refresh controls added to desktop navigation.
- Watchdogs close over ID and check it against a synchronous current-request ref. Rapid Transactions -> Wallets taps mean old Transactions timer/exception cannot overwrite Wallets state. Only a matching latest requested pathname clears mobileRequest and feedback. A late commit for an earlier request must not revert requested highlight. A late commit for latest destination clears delayed feedback even after watchdog elapsed. Changing source to a new non-mobile navigation cancels mobile intent, preventing an old mobile selection from overriding an explicit account-menu/browser flow.
- Browser Back/Forward is an explicit replacement navigation: clear mobileRequest on popstate before committed-path selection. Ordinary unrelated pathname changes are not sufficient to discard the latest pending mobile request, because they may be a late earlier commit. Add/remove popstate listener with provider lifetime; desktop state remains unaffected.
- While delayed/failed, tapping the selected destination normally requests it again when NavigationLink admits its href. If the browser is already at that destination, current-link same-URL handling remains unchanged; the dedicated refresh action handles same-destination reload.
- **Refresh policy:** `refreshMobileDestination` performs `window.location.assign` to the captured latest same-origin requested href after validating its URL against current origin and allowed mobile destination paths. This explicitly reloads/opens the requested page whether committed or not; router.refresh alone would refresh the stale old route, and another router.push may reuse the same failed client cache. A full navigation also provides an observable browser loading/retry path without undocumented Next internals. Preserve any approved URL query/hash; no arbitrary external destination assignment. Button is guarded against double activation and shows refreshing state if location navigation is mocked/delayed. It does not call any financial command or submit a form.
- A refresh replaces the SPA document, so unsaved local form state may be lost. Recovery is outside open dialogs and the existing visibility hook suppresses it while a modal is open or editable keyboard is active. Do not automatically reload, auto-click refresh, replay a pending transaction, or clear a financial controller to recover navigation. Existing server request UUID safeguards remain unchanged, but this task must not claim in-memory unknown-outcome state survives a document reload. Root must verify recovery against actual financial-session behavior and document this limitation.
- On breakpoint transition to desktop, hide mobile recovery and mobile selection visually; preserve requested intent if user returns to mobile while it remains unresolved, unless a new explicit navigation superseded it. No desktop error panel or selection change. Unmount cancels timers/listeners and invalidates current request IDs.

## Recovery layout

`MobileNavigationRecovery(): JSX.Element|null` consumes mobileRequest and refreshMobileDestination plus existing mobile visibility hook. Render below 1024px, outside fixed nav, in the main content region of DashboardLayoutClient. Loading state shows the requested page label and neutral skeleton placeholders using existing `Skeleton` primitives; use existing TableSkeleton for Transactions only if it fits the current page's layout. Skeletons have no fake values, percentages or interactive controls, and respect reduced motion. Delayed/failed state replaces skeleton with a compact opaque semantic feedback surface, readable theme tokens, existing typography, alert/status copy and RefreshCw decorative icon with a 44px minimum button. Visible **Try to refresh** accompanies the icon; no icon-only recovery ambiguity. Include requested destination label so users know what will refresh.

Wrap the real route children in a stable element. While a mobile request is loading/delayed/failed, hide that old content and remove it from focus/accessibility on mobile only, leaving React children mounted. Use breakpoint-aware hidden/inert state rather than applying aria-hidden/inert permanently based on a request: at >=1024px actual page content must remain visible, accessible and actionable. Use the existing matchMedia/resize pattern and clean up listeners. Do not unmount existing dialogs or reset financial forms. If a modal/keyboard suppresses the placeholder, keep the underlying old-content visibility policy explicit: preserve the open modal and its current usable form; never inert an active dialog ancestor. Nav already prevents normal taps while a modal is open, but tests must cover a dialog opening while a route is outstanding.

No focus stealing when watchdog fires; announce feedback politely and let keyboard users reach the refresh button. Keep nav available to choose another destination. Recovery suppresses behind modals/keyboards and restores after dismissal. At 320/375px and 200% text zoom, wrap text/actions without overflow. Desktop wrapper is hidden and mobile-only media rules leave desktop layout unchanged.

## Meaningful RED/GREEN checks

- [ ] Provider/integration tests with fake timers and deferred route commits: immediate selected visual destination while aria-current remains old route; requested skeleton visible and old mobile content inaccessible; 7999ms skeleton remains; 8000ms skeleton removed, delayed feedback and requested highlight retained; no automatic routing/refresh/write; latest matching commit clears state and restores actual destination; older late commit does not; rapid-tap stale timer cannot overwrite new request; synchronous push throw produces failed feedback.
- [ ] Link tests: Ctrl/Meta/Shift/nonprimary/defaultPrevented clicks do not create mobile intent; accepted normal click does. Normal non-mobile navigate still has original pending/watchdog behavior. Browser popstate supersedes mobile selection; listener/timer cleanup is tested.
- [ ] Recovery tests: skeleton-to-prompt switch and old-content preservation, required heading/honest delayed copy and visible Try to refresh; activating calls same-origin browser navigation with latest requested URL, not router.refresh or stale pathname; repeated activation guarded; keyboard activation works; modal/keyboard suppress placeholders without disabling an active dialog; desktop always exposes actual content and no mobile placeholder/inert state; no automatic financial apply, quote or reset call. Use an injectable/mocked location navigation boundary for tests without changing URL-policy behavior.
- [ ] Preserve existing suspended latest-navigation tests and indeterminate LoadingBar assertions. Run `npx vitest run tests/navigation.test.tsx tests/mobile-navigation.test.tsx tests/mobile-navigation-recovery.test.tsx` for RED then GREEN, plus `node --test tests/navigation-goals.test.cjs` and `npx tsc --noEmit`. Adapt exact test filename if integrated into current navigation suite.
- [ ] Root browser: slow/offline route at mobile viewport, immediate highlight, late arrival, refresh requests selected route, rapid tabs, normal/current links and Back; desktop sidebar remains committed; keyboard/live announcements/themes/320px/safe-area and modal visibility. Record actual browser limitations, not simulated definitive failure. Sol medium reviews concurrency and financial recovery implications before root integrates.

## Unavoidable limitations

Watchdog is a delay detector. The current Next API cannot reliably report every route failure, and matching pathname cannot certify successful data loading. Explicit browser refresh can discard an unsaved local draft and document-lifetime recovery state; it must never trigger automatic financial writes. Full refresh is a user action, not an automatic retry. Device/browser acceptance needs actual observation after implementation.
