# Mobile/PWA and Manual QA Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement approved tasks one at a time. Steps use checkbox syntax for tracking.

**Status:** Settings Task 4 first release approved October 7 after the user said to proceed. Implement profile, Light/Dark/System, truthful installation guidance, account/sign-out and financial help using existing services. Other follow-ups remain pending. Export, hide amounts and additional account controls are outside this approval.

**Goal:** Preserve manual QA findings and make Monetigia easier to navigate and manage on mobile and in standalone PWA mode.

**Architecture:** Keep the existing financial command lane authoritative. Restore adds a lifecycle command; overspend confirmation presents the existing quote without changing accounting. Mobile navigation reuses transition-aware links, while Settings consumes existing profile and theme facilities.

**Tech Stack:** Next.js 14, React, Tailwind, Radix dialogs, SWR, Supabase/PostgreSQL.

**Spec:** User instructions and QA findings from 2026-10-07, captured below. Navigation still needs design approval. Settings first release was approved and implemented.

## Confirmed requests and findings

- Overspend release choices should appear in a separate popup confirmation dialog with Keep reservations and Release funds and save. Current inline notice works but is not the preferred presentation.
- Mobile/PWA navigation is difficult. User supplied an Apple/iOS floating glass bottom-navigation reference. Use glass on this navigation surface only, with readable light/dark states and an opaque fallback.
- Archived goals need a discoverable recovery flow. Restore returns a goal to Closed Goals; Reopen is a separate action. Do not restore reservations or change wallet balances.
- Settings has not been redesigned since beta. Current implementation primarily edits profile name/photo and displays OAuth providers. It needs useful controls and the Goals visual language.
- Transaction modal auto-close was fixed locally during QA: successful save plus successful refresh closes it; refresh failures preserve the saved notice. Include this in final regression verification.

## Current code evidence

- Settings: src/app/(dashboard)/settings/page.tsx. Profile load errors currently only reach the console; avatar upload uses /api/user/upload-avatar.
- Theme: src/components/providers/theme-provider.tsx and src/components/theme/ThemeToggle.tsx.
- Navigation: src/components/layout/sidebar.tsx, navigation-provider.tsx, navigation-link.tsx, header.tsx.
- Manifest exists at src/app/manifest.ts. It declares standalone display and portrait-primary orientation. Icon entries both point to the same image with declared 192/512 sizes; verify actual dimensions before claiming install readiness. Service-worker/offline behavior has not been established by this planning inspection.
- user_preferences types include theme, currency, language and notifications_enabled. Type presence alone does not prove working persistence or implemented features.
- Goals: use-goals.ts filters archived goals out; contracts.ts currently supports archive/reopen but no restore command. Restore needs backend review, not a direct frontend archived_at update.

## Global constraints

- Work on codex/goal-reservations until integration is separately authorized; push is now authorized after verification; no beta merge or deployment.
- Preserve ongoing manual QA and existing uncommitted changes. Do not reset seed data without explicit instruction.
- Existing Manrope/Bricolage typography and shared primary green; ENERGY 1 / RHYTHM 2 / MOTION 1.
- 44px minimum touch targets; safe-area padding; keyboard focus; reduced motion; 375px, 768px and 1280px in both themes.
- Offline financial writes are outside this plan. State clearly when online access is needed; never show fabricated successful saves.
- No inert Settings toggles. Currency conversion, localization, push reminders and biometric/app locks require their own functional design.

## Review focus

1. Stale overspend quote while popup is open: reject/requote without duplicate expense (Task 1).
2. Restoring another user's or active goal: reject; restoration changes no allocation ledger (Task 2).
3. Bottom navigation with keyboard, safe area and open dialogs: no obscured fields/actions or focus conflicts (Task 3).
4. Failed preference/profile save: show error and retain usable values without false success (Task 4).
5. Unsupported install/offline/update capabilities: display truthful guidance without broken controls (Tasks 4 and 5).

## Task 1: Overspend popup confirmation

**Files:** Modify src/components/transactions/GoalReleaseNotice.tsx, AddTransactionModal.tsx; create src/components/transactions/GoalReleaseDialog.tsx if extraction is useful; update tests/transaction-release.test.tsx.

**Interface:** Consume existing TransactionQuote, draft, snapshot, release callbacks and unresolved-save state. Existing financial RPC behavior stays authoritative.

- [ ] Add failing behavioral coverage: popup opens for required releases; Keep reservations saves nothing; confirm writes once; stale quote requires fresh review; Escape cancels review; failed/unknown save remains recoverable.
- [ ] Run npx vitest run tests/transaction-release.test.tsx and confirm expected failures.
- [ ] Present quote amounts and affected goal names in a Radix confirmation dialog. Avoid competing nested focus traps: suspend the underlying form appropriately and return focus after cancellation.
- [ ] Verify cancellation, multiple-goal release customization, pending state, double click and successful auto-close with the same request IDs.
- [ ] Run focused tests, TypeScript and rendered mobile/keyboard checks; commit only reviewed changes.

## Task 2: Archived goals and Restore

**Files:** Modify src/lib/goals/contracts.ts, src/hooks/use-goals.ts, src/app/(dashboard)/goals/page.tsx; create src/components/goals/ArchivedGoalsDialog.tsx and a new Supabase migration after inspecting the current lifecycle SQL. Update tests/database/goal-lifecycle.test.mjs and tests/goal-actions.test.tsx.

**Interface:** Add authenticated financial command { kind: "restore", goalId }. Expose archived goals through an owner-scoped read. Restore clears archival state while preserving completed/cancelled lifecycle; Reopen remains separate.

- [ ] Test archive -> list archived -> restore -> closed -> reopen. Assert unchanged actual/reserved balances on restore, retained history, same-request replay, owner restrictions and rejection of invalid active-goal restoration.
- [ ] Run focused UI/DB tests and confirm expected failures before implementing the lifecycle command.
- [ ] Add Archived Goals entry on Goals and a Restore action. Empty/loading/error states must be explicit; successful restore refreshes both lists.
- [ ] Verify DB write guards and atomic behavior; run npm run test:db and focused UI tests; review before commit.

## Task 3: Mobile/PWA glass navigation

**Files:** Create src/components/layout/mobile-navigation.tsx; modify dashboard layout, sidebar/header only as needed; reuse navigation-link.tsx and navigation-provider.tsx. Update tests/navigation.test.tsx for behavioral regression.

**Proposed layout:** Bottom tabs Dashboard, Transactions, Wallets, Goals, More. More exposes Categories and Settings. Desktop retains its sidebar. Final tab arrangement requires user design review.

- [ ] Approve a narrow-screen design with the supplied Apple reference; retain Monetigia green rather than copying the reference's pink accent.
- [ ] Add navigation behavior coverage: pending feedback, current route, modified clicks, More menu keyboard access and closing after navigation.
- [ ] Implement one floating glass surface with opaque fallback, clear labels, active state and sufficient contrast. Use actual route links and DOM order matching visual order.
- [ ] Reserve bottom content space plus env(safe-area-inset-bottom); hide/disable navigation appropriately behind dialogs. Check virtual keyboard, standalone mode, scrolling and 200% text zoom.
- [ ] Verify at all target widths/themes, reduced motion and cached/cold navigation; review before commit.

## Task 4: Useful Settings redesign (completed first release)

**Files:** Modify src/app/(dashboard)/settings/page.tsx; extract sections under src/components/settings/ when useful. Reuse existing theme provider, profile API and installed auth facilities. Create preference hook only after verifying user_preferences table, RLS and actual persistence.

**Recommended first release:**

- Profile: name/photo and read-only sign-in email, with visible load/save/upload errors and retry.
- Appearance: Light, Dark, System using the shared theme provider. Define persistence precedence and avoid a second conflicting theme store.
- App installation: install button only when a real browser install prompt is available; platform-specific Add to Home Screen guidance otherwise; show installed state when detectable.
- Data and privacy: hide monetary amounts with an explicit preference if approved; CSV export of owned transactions if approved, with proper CSV quoting/formula-injection protection. Currency stays PHP until real conversion is supported.
- Account: connected OAuth provider and working Sign out. Do not invent password/session-management controls unsupported by the current auth model.
- About/help: version/build information sourced from the app and a short explanation of Actual, Reserved, Available and goal progress.

**Later, separate scope:** account deletion, push reminders, backup/import, cross-device preferences and local app lock. Do not ship switches for these before capabilities exist.

- [x] User reviews first-release feature selection and design. Prefer grouped settings rows with Goals typography/surfaces rather than reproducing old stacked cards.
- [x] Add behavior tests for selected controls: persistence/reload, system theme, failure/retry, sign-out and real install availability. Export tests apply only if export is approved.
- [x] Implement approved sections with native inputs, accessible labels, 44px controls and pending/error feedback. Preserve OAuth profile functionality.
- [x] Verify approved controls with behavioral tests, theme/layout browser checks and independent review; live upload/sign-out and physical iOS checks remain explicitly limited in SETTINGS_VERIFICATION.md.

## Task 5: PWA acceptance and final handoff

**Files:** Inspect src/app/manifest.ts, src/app/layout.tsx, public assets and existing runtime registration before choosing any additional PWA files. Record results in docs/codex-review/MOBILE_SETTINGS_VERIFICATION.md.

- [ ] Check actual manifest icons, start URL/auth routing, install behavior, standalone layout and orientation. Adjust orientation only after user review; do not assume a manifest supplies offline support.
- [ ] If an offline screen/update mechanism is approved, design it separately. Auth/API financial responses must not be indiscriminately cached; pending financial requests must not be silently replayed.
- [ ] Verify full manual QA including reserve/spend/delete, completed-goal deletion, overspend decline/confirm, release, move, restore/reopen and credit installments. Record user-observed evidence separately from automated results.
- [ ] Run TypeScript, npm test, npm run test:db when lifecycle SQL changes, lint and production build. Build in an isolated output/check environment or coordinate with the active preview to avoid breaking its CSS.
- [ ] Record exact results, baseline warnings, rendered screenshots and antislop delivery checks. Preserve no-push instruction and hand off for final integration review.

## Manual QA progress as reported by user

- Passed: active-goal expense deletion; completed-goal deletion; overspend warning and confirmed save; release accounting; moving reservations; reopened goal showing zero; archive hiding a goal.
- Missing UI found: restoring an archived goal.
- Remaining manual checks: credit/installment behavior, final responsive/light-theme/keyboard coverage and fresh browser confirmation of transaction auto-close.
- Current known fixture after move: GCash actual 2,000; QA Laptop reserved 1,000; Phone total reserved 2,000; Debt Goal reserved 1,000; aggregate reserved 4,000. Re-read current data before prescribing exact new tests.

## Execution handoff

### Newly approved installment work

User approved grouped installment purchases, Date added/Transaction date sort, separate editable first payment due date defaulting one month after local purchase date, and an improved payment-schedule modal. Execution is tracked in [2026-10-07-installment-history.md](2026-10-07-installment-history.md). This approval applies to installment work only; the Settings/navigation proposals above remain pending design review. Backend model explicitly requested: Sol high. Luna coding uses max; lighter Luna checks use medium/high. Astra is now permitted if needed.

This draft preserves requests before context loss. Installment implementation is now authorized as recorded above. User should approve Settings selection and navigation design before executing those separate changes. Preserve the user's model preferences and later overrides above. Review each meaningful task without spawning unnecessary agents for tiny visual changes.

## Approved iOS Home Screen icon fix (October 7)

Use the existing Monetigia logo for Safari/iOS Add to Home Screen with a correctly sized Apple touch icon and accurate manifest assets. Verify emitted metadata and actual PNG sizes locally; native iPhone installation remains a manual QA check. Existing installations may need removal and re-addition to refresh cached icon metadata.


## Latest execution status

Installment scope and icon assets implemented and verified; see docs/codex-review/INSTALLMENT_HISTORY_VERIFICATION.md. The later model override allows Sol low/medium and Luna max for coding (medium/high for lighter checks); no new Astra or Sol high. The latest user instruction authorizes commit and push after Settings and footer fixes. Settings first release is complete; navigation, restore and popup remain pending. See SETTINGS_VERIFICATION.md for final integrated evidence.

Root delivery status: approved Settings first release, shared theme timing, fixed modal footer and sidebar breakpoint fixes passed review and fresh integrated verification. Physical PWA acceptance and Tasks 1–3 remain pending; do not mark them complete.

## Manual QA finding — opening debt omitted (October 7)

User observed wallet credit balance PHP 6,600 while All months Outstanding Debt showed PHP 1,600 after a PHP 400 debt payment. Source inspection confirms the month summary derives only from transactions and excludes the initial PHP 5,000 account debt. The All months label and Deduct Debt preview therefore understate total debt in this fixture. Payment accounting itself was user-verified: Cash 10,000 -> 9,600; debt 7,000 -> 6,600.

Status: recorded, not fixed. Preserve initial balance; do not create a duplicate PHP 5,000 expense. Follow-up must reconcile opening debt with transaction-derived monthly amounts and define treatment of undated opening debt without double counting.

## Newly agreed debt work

Design and implementation tasks are saved in docs/superpowers/specs/2026-10-07-existing-debt-selection-design.md and docs/superpowers/plans/2026-10-07-existing-debt-selection.md. These are planning artifacts only. User also observed PHP 400 payment deletion restored Cash to 10,000 and card debt to 7,000. New user instruction authorizes building and integrating current completed code into origin/beta; the opening-debt bug remains known, not fixed by documentation.
