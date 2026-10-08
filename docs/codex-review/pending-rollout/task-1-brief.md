# Task 1 brief: Mobile/PWA navigation

**Executor:** Luna max. **Reviewer:** Sol medium. **Baseline:** `codex/mobile-pwa-follow-ups`, main `56ce652`; re-read current files and preserve later changes. User authorized implementation. Antislop during is already resolved and announced in this session.

Read [AGENTS.md](../../../AGENTS.md), [core](../../../.agents/skills/antislop/SKILL.md), [UI](../../../.agents/skills/antislop-ui/SKILL.md), [human](../../../.agents/skills/antislop-human/SKILL.md), [mobile](../../../.agents/skills/antislop-layoutmobile/SKILL.md), [copy](../../../.agents/skills/antislop-copywriting/SKILL.md), and explicitly invoked [comment hygiene](../../../.agents/skills/antislop-code/SKILL.md). Comment hygiene authorizes comment changes only; the product implementation authority comes from the user and this task. Preserve valuable constraints/workarounds, remove only obvious comment noise in touched code, and avoid narrated/banner comments.

## Outcome and boundaries

Below the existing `lg`/1024px breakpoint, replace the hamburger/drawer primary navigation with five floating bottom controls: Dashboard `/dashboard`, Transactions `/transactions`, Wallets `/accounts`, Goals `/goals`, More. More opens an opaque accessible menu with Categories `/categories` and Settings `/settings`. At 1024px and above retain the existing sidebar and collapse preference. Keep header theme/account controls.

Use the user's Apple floating-glass reference as navigation direction, Monetigia green and current typography. ENERGY 1 / RHYTHM 2 / MOTION 1. Glass belongs only to the new navigation surface in this change; More stays opaque. Its blur distinguishes persistent navigation from scrolling financial content. Existing relevant Dashboard/transaction/wallet/goal glyphs retain their meanings. No pink reference accent, new assets, dependencies, financial changes, service worker, settings feature, routing rewrite or global press/bounce motion.

## Exact file scope

Create:

- `src/components/layout/mobile-navigation.tsx`: `export function MobileNavigation(): JSX.Element`; route controls, controlled More menu and visibility integration.
- `src/hooks/use-mobile-navigation-visibility.ts`: `export function useMobileNavigationVisibility(): { blockedByModal: boolean; keyboardOpen: boolean }`; browser-only observations with cleanup.
- `tests/mobile-navigation.test.tsx`: rendered navigation behavior, routes, menu and pending state.
- `tests/mobile-navigation-visibility.test.tsx`: mocked VisualViewport, focus, modal mutations and cleanup.

Modify:

- `src/components/layout/dashboard-layout-client.tsx`: mount mobile nav, mobile content clearance and desktop-only sidebar; keep desktop collapse state. Close More on route/breakpoint changes inside nav.
- `src/components/layout/header.tsx`: remove the obsolete narrow hamburger and optional `onMenuClick` contract after layout no longer uses it. Preserve account/theme behavior.
- `src/app/globals.css`: only scoped `.mobile-navigation` and dashboard bottom-clearance rules, opaque fallback, supported backdrop blur, safe-area and reduced motion.
- `src/app/layout.tsx`: add `viewportFit: "cover"` to existing exported `Viewport`; preserve width/initialScale and unrestricted zoom.
- `tests/sidebar-breakpoint.test.tsx`: replace old mobile-drawer expectations with bottom-nav/desktop-collapse continuity; adapt mocked Header to its new contract.
- Existing custom modal outer roots in `src/components/accounts/AddAccountModal.tsx`, `src/components/categories/AddCategoryModal.tsx`, `src/components/goals/AddGoalModal.tsx`, and account-delete overlay in `src/app/(dashboard)/accounts/page.tsx`: add only `data-mobile-nav-blocking=""` to the conditionally mounted overlay root. These lack shared Radix modal semantics; no form/finance/style rewrite.

Reuse, do not change: `NavigationLink` in `navigation-link.tsx`, `useNavigation()` in `navigation-provider.tsx`, existing `DropdownMenu` exports, `cn`, existing theme tokens and sidebar. `tests/navigation.test.tsx` and `tests/navigation-goals.test.cjs` must still pass.

## Interfaces and behavior decisions

- `useNavigation()` supplies `pendingHref: string|null` and `navigate(href: string): void`; `NavigationLink` retains normal anchor href and modified-click handling. More entries use `DropdownMenuItem asChild` with `NavigationLink`; controlled `open/onOpenChange`, `modal={false}`, top placement. Escape closes and returns focus to More; ordinary route navigation closes it. No second custom routing layer.
- `usePathname()` determines `aria-current="page"` on the matching primary destination. More has active styling on `/categories` or `/settings`; its destination item, rather than a non-link button, owns `aria-current`. Pending destination exposes `aria-busy` with visible feedback; retain labels.
- Nav is `aria-label="Primary mobile navigation"` with DOM order matching display. More is a button with its visible label and Radix expanded semantics. Icons are decorative/aria-hidden. Each control and menu entry has a minimum 44px width/height; allow labels to wrap at 200% text zoom rather than clip.
- Use fixed positioning at `bottom: calc(12px + env(safe-area-inset-bottom, 0px))`, 12px side clearance, centered maximum width 560px and five equal columns. Surface has rounded corners, border and one restrained elevation shadow; no per-item glow. Active green treatment uses measured readable text contrast. Base surface is opaque `hsl(var(--card))`; only a supports rule enables translucent backdrop blur. Keep labels legible over bright/dark page content.
- Define `--mobile-navigation-height: 72px` as the initial surface minimum and measure actual outer surface with `ResizeObserver` when available. Write the measured height to the dashboard shell variable; mobile main bottom padding is measured height + 24px + safe-area inset. At `lg`, restore current main padding with no mobile gap. Text zoom growth must increase clearance; observer cleanup removes stale overrides. If ResizeObserver is unavailable use the minimum plus browser visual verification.
- `blockedByModal` observes mounted `[role="dialog"][aria-modal="true"]`, `[role="alertdialog"][aria-modal="true"]`, and `[data-mobile-nav-blocking]`, ignoring hidden/aria-hidden nodes. Existing Radix transaction/detail/goal dialogs already provide roles; custom markers cover the roots above. MutationObserver listens for subtree child changes and `role`, `aria-modal`, `hidden`, `aria-hidden`, `data-state`, `data-mobile-nav-blocking` attributes. Initial scan is required. More uses `role="menu"` and is excluded. Do not detect only `body[data-scroll-locked]`, since dropdowns can lock scroll too.
- Keyboard suppression requires focused editable input/textarea/contenteditable (exclude buttons, checkbox/radio and readonly/disabled), VisualViewport available, scale within 0.05 of 1, and layout height minus visual viewport height greater than 120px. Recompute on focusin/focusout and VisualViewport resize/scroll; support missing VisualViewport without throwing. Pinch zoom alone must not hide navigation. Blur/keyboard dismissal restores it. Listen/observer cleanup is mandatory.
- When either visibility flag is true, hide the nav from view and focus with `hidden`, close More, retain content clearance, and avoid focusing a removed trigger over a newly opened dialog. Desktop CSS hides the entire mobile nav. A desktop transition closes More. Dialog handling does not alter the dialog or financial controller.

## Execution steps

- [ ] 1. Add failing tests for all four primary hrefs/order; More Categories/Settings; current route and More active state; `pendingHref`; normal versus Ctrl/Meta/Shift click preserving browser behavior; Escape/focus return; route change closes menu. Extend the existing navigation mocks and use user-event where keyboard semantics matter.
- [ ] 2. Add visibility tests: mounted/unmounted Radix dialog and custom marker block/restore nav; More alone does not block; focused text input with scale 1 and viewport loss 250px suppresses; blur restores; scale 2 does not suppress; a resize without editable focus does not suppress; missing APIs are safe; unmount removes listeners/observers. Run `npx vitest run tests/mobile-navigation.test.tsx tests/mobile-navigation-visibility.test.tsx` and observe expected failures.
- [ ] 3. Implement the visibility hook and marker-only compatibility edits exactly within scope. Test source-level financial behavior is unaffected by these markup edits.
- [ ] 4. Implement mobile nav using existing links/menu, scoped visual rules and height measurement. Integrate dashboard/header/viewport; preserve desktop collapse preference and update breakpoint tests to assert desktop -> mobile -> desktop keeps collapse state and mobile exposes no drawer/hamburger.
- [ ] 5. Run `npx vitest run tests/mobile-navigation.test.tsx tests/mobile-navigation-visibility.test.tsx tests/sidebar-breakpoint.test.tsx tests/navigation.test.tsx`, `node --test tests/navigation-goals.test.cjs`, and `npx tsc --noEmit`. Fix genuine failures; do not replace behavioral assertions with class-only assertions. Tests verify browser decisions, not actual iOS rendering.
- [ ] 6. Root renders 320/375/768/1280px in light/dark: all routes and More, pending/cold navigation, desktop collapse round trip, final page action reachable, opaque fallback, no horizontal overflow, 44px controls, keyboard Tab/Enter/Escape, reduced motion and 200% text zoom. Measure actual nav clearance and contrast. Verify Add Transaction, Add Wallet, Add Goal, Categories and delete dialogs suppress it. Physical Safari/Home Screen keyboard/safe area remains user-device acceptance; record it honestly.
- [ ] 7. Sol medium reviews routing/modals/viewport/contrast and diff scope. Fix findings; root runs normal `npm test`, `npm run lint`, and isolated production build when integrating the task. Record fresh results and antislop gate evidence in `docs/codex-review/PENDING_ROLLOUT_VERIFICATION.md`. No commit/push unless the root requests it; hand the reviewed code and exact limitations back to root.

## Acceptance and delivery gate

Task passes when the requested destinations work at the existing breakpoint, nav follows theme/zoom/viewport, modal and keyboard interaction remains reachable, desktop sidebar behavior survives, and scoped checks pass. Apply antislop Hard/Purpose/Liveliness/Craftsmanship plus UI/human/mobile/comment checklists to the actual implementation. Planning documents do not certify rendered contrast or device behavior. Do not claim physical iOS acceptance from jsdom or desktop viewport emulation.
