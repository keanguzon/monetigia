# QA 11 visual corrections brief

**Goal:** Show the mobile primary navigation as five equally sized icon-only destinations in one row at every mobile width, while retaining accessible route names. Replace delayed/failed recovery cards with centered, unboxed refresh feedback.

**Scope:** `src/components/layout/mobile-navigation.tsx`, `src/components/layout/mobile-navigation-recovery.tsx`, recovery/navigation rules in `src/app/globals.css`, and their focused tests. No route/provider/timeout/financial logic, data changes, dependency, commit, or push. Desktop navigation stays unchanged. Implementation follows the user's Luna max workflow; review follows Sol medium.

**Direction:** Existing Monetigia glass material and primary green. Five equal mobile slots use icons only; accessible names remain on their links. The recovery glyph is the focal point, with short truthful copy and no card chrome. Preserve reduced-motion, theme, safe-area, focus, and 44px target behavior.

## 1. Centered recovery

- Keep loading skeletons and desktop/modal/keyboard suppression unchanged. Change only delayed/failed feedback markup and styling.
- Place an approximately 40px refresh glyph above short centered copy in the available content area. Put it in a transparent semantic button with a minimum 44px by 44px hit target. Remove the visible card border, panel background, card padding treatment, and boxed button chrome. Preserve a visible keyboard focus indicator.
- The icon button calls the existing `refreshMobileDestination`, has an accessible name such as `Refresh ${label}`, and keeps `disabled`, `aria-busy`, and the refreshing live announcement. Hide the decorative SVG from assistive technology. Do not add another action button.
- Failed feedback says “Can't load page” and “Please try again.” Delayed feedback says “Taking longer than expected. Try refreshing.” without a failed heading. Do not describe a delayed request as definitively failed. Keep polite, atomic status feedback without duplicate announcements.
- Center the action and message within the remaining area between header and bottom navigation. Use a content-aware minimum height that accounts for the existing measured nav reservation and safe area, with a `100vh` fallback plus dynamic viewport height where supported. Do not add a fixed overlay, a second fixed `100vh` block, or clipping that cuts off enlarged copy.

## 2. Equal icon-only navigation

- Use five equal grid tracks at all mobile widths, including 320px. Do not switch to a two-row layout at narrow widths. Keep a minimum 44px by 44px target for every destination; active state must not resize a slot or the shared indicator.
- Remove visible route labels. Retain each route name through its link's accessible name (`aria-label`); decorative destination icons stay hidden from assistive technology. Active selection colors the icon with the existing primary green token. Use 24px destination icons where the 44px controls allow.
- Preserve all five destinations and routes, theme-specific glass/fallback rules, safe area, hidden states, active-indicator motion, reduced motion, and measured height. Keep the indicator inset identical in every slot. Do not change desktop navigation.
- At 320px, 375px, 412px, and 768px verify one row, five equal control and indicator widths, 44px minimum targets, no horizontal overflow or clipped focus. Since labels are visually removed, no label-fit or two-row fallback is needed; accessibility names must still be present.

## Acceptance evidence

- Root records all five control and selected-indicator bounds at 320/375/412px, checks no horizontal overflow, and verifies the one-row material in both themes.
- Verify delayed and failed recovery at 375/412px in both themes: large actionable glyph above short centered copy, no panel/button box, truthful delayed wording, keyboard activation, visible focus, and refreshing busy feedback.
- Run `tests/mobile-navigation.test.tsx`, `tests/mobile-navigation-recovery.test.tsx`, `tests/mobile-navigation-visibility.test.tsx`, and `tests/sidebar-breakpoint.test.tsx` with Vitest. Run `npx tsc --noEmit` during integrated verification. Root reviews screenshots and integrated diff before completion.

Brief review: the latest user instruction overrides the earlier visible-label and narrow two-row directions. Product visual/accessibility delivery remains pending integrated review of recovery rendering and the final diff.
