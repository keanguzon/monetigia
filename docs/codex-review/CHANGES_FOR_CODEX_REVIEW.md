# Monetigia - Changes for Codex Review

> **Date:** October 6, 2026  
> **Branch:** `beta`  
> **Author:** Antigravity AI (Pair Programming with User)  
> **Subject:** Dashboard, Wallets, and Goals Unification & PWA-First Implementation Review

---

## 1. Executive Summary

This document summarizes the changes implemented to address the unification of **Dashboard**, **Wallets**, and **Goals**, satisfy the **PWA-first** requirement, eliminate navigation loading lag, resolve skeleton layout shifts, and remove redundant UI controls.

All changes were strictly verified with:
- `npx tsc --noEmit` (0 errors)
- `npx vitest run` (10 of 10 tests passed across `tests/navigation.test.tsx` and `tests/contributions.test.tsx`)
- `npm run build` (Next.js 14 production build succeeded with all 20 pages statically optimized and `/manifest.webmanifest` generated)

---

## 2. Inventory of File Changes

### A. New Files Created
1. `src/app/manifest.ts`: Next.js 14 App Router PWA Web App Manifest (`/manifest.webmanifest`) with application branding, icons, dark background/theme colors, and standalone display.
2. `src/components/layout/navigation-link.tsx`: Drop-in replacement for `next/link` that intercepts clicks and immediately notifies `NavigationProvider` of the intended destination before the Next.js router transition starts.
3. `src/components/layout/navigation-provider.tsx`: Context provider that tracks immediate `pendingHref`, triggers React `startTransition`, and listens for `pathname` updates to clear the indicator instantly when the route renders (with an 8s fallback timeout).
4. `src/components/goals/GoalCardSkeleton.tsx`: Pixel-calibrated skeleton matching the exact box model, padding (`p-4 sm:p-5`), header, progress track, action button, and footer of `GoalCard.tsx`.
5. `src/components/goals/GoalSelector.tsx`: Dedicated dropdown selector allowing transactions in `AddTransactionModal` to be linked to an active goal.
6. `src/components/ui/financial-summary.tsx`: Reusable design tokens (`summaryPanelClass`, `summaryAmountClass`, `pageTitleClass`) and `SummarySkeleton` supporting both 3-column (Goals) and 4-column (Dashboard) layouts with matching interior hairline dividers (`divide-border/30`).
7. `src/lib/goal-funding.ts`: Helper calculating goal progress and filtering contributions by transaction type and goal association.
8. `src/lib/navigation.ts`: Pure helper determining whether a clicked link qualifies as an internal SPA route navigation (ignoring external links, new tab clicks, modifier keys, and hash-only links).
9. `src/lib/refresh-financial-data.ts`: SWR cache invalidation dispatcher that syncs accounts, recent transactions, dashboard stats, and goals across pages.
10. `tests/navigation.test.tsx`: Vitest suite testing instant loading indicator display on navigation click and clearance upon route mounting.
11. `tests/contributions.test.tsx`: Vitest suite testing goal contribution tracking for expenses, transfers, income exclusion, and installment handling.
12. `vitest.config.ts`: Vitest test configuration with jsdom environment and path aliasing.

### B. Files Deleted
1. `src/app/(dashboard)/transactions/new/page.tsx`: Legacy standalone fallback page deleted.
2. `src/components/forms/AddTransactionForm.tsx`: Unused standalone form deleted to ensure a single, consistent transaction flow via `AddTransactionModal`.

### C. Files Modified
1. `next.config.js`: Added permanent redirect from `/transactions/new` to `/transactions`.
2. `src/app/layout.tsx`: Configured PWA `viewport` (`userScalable: false`, `themeColor: "#09090b"`), PWA metadata (`appleWebApp`, `manifest: "/manifest.webmanifest"`), and wrapped children in `NavigationProvider` and `LoadingBar`.
3. `src/app/(dashboard)/accounts/page.tsx`:
   - **Removed Redundant "Add Wallet" Buttons:** Removed the large desktop top-right button and mobile full-width button. Kept only the sleek, modern `Add Wallet` button located next to the Tiles/Ledger view switcher.
   - **Header & Masthead Alignment:** Unified page title with `pageTitleClass`, added total accounts pill badge (`${accounts.length} Total`), and aligned editorial balance masthead typography with Goals.
   - **Preserved Core Features:** Retained all wallet tile cards, drag-and-drop reordering, ledger view toggle, net worth toggle, APY pill editor, and debt schedule section completely intact.
4. `src/app/(dashboard)/dashboard/page.tsx`:
   - Unified overview metrics with `summaryPanelClass`, `summaryAmountClass`, and `SummarySkeleton columns={4}`.
   - Preserved interior hairline dividers (`border-border/30`) and responsive grid layout.
5. `src/app/(dashboard)/goals/page.tsx`:
   - Added `GoalCardSkeleton` to loading state.
   - Added crisp instructional guidance: *"Transactions tagged with a goal automatically increase its funded amount. Monthly and kinsenas targets estimate completion only."*
6. `src/components/goals/GoalCard.tsx`: Added "Add contribution" button that launches the transaction modal with the current goal preselected.
7. `src/components/transactions/AddTransactionModal.tsx`: Added `GoalSelector` support and refreshed financial data via `refreshFinancialData()` upon transaction save.
8. `src/components/layout/sidebar.tsx` & `src/components/layout/header.tsx`: Replaced standard `Link` with `NavigationLink` and added visual loading spinners (`pendingHref === item.href`) for instant feedback.
9. `src/components/ui/loading-bar.tsx`: Rendered top progress bar connected to `pendingHref` from `NavigationProvider`.
10. `tests/contributions.test.tsx`: Fixed TypeScript error where `{ exact: true }` was passed to `screen.getByRole`.

---

## 3. Detailed Verification Results

### 1. TypeScript Compilation
```bash
$ npx tsc --noEmit
# Exit code: 0 (No type errors)
```

### 2. Vitest Test Suite
```bash
$ npx vitest run
# Output:
# ✓ tests/navigation.test.tsx (2 tests)
# ✓ tests/contributions.test.tsx (8 tests)
# Test Files  2 passed (2)
# Tests       10 passed (10)
```

### 3. Production Build
```bash
$ npm run build
# Output:
# ✓ Compiled successfully
# ✓ Generating static pages (20/20)
# Finalizing page optimization ...
# ├ ○ /manifest.webmanifest 0 B
# Exit code: 0
```

---

## 4. Suggested Review Checklist for Codex

1. **PWA Integration:** Verify `src/app/manifest.ts` properties and `src/app/layout.tsx` metadata headers.
2. **Instant Navigation:** Check `src/components/layout/navigation-provider.tsx` and `src/components/layout/navigation-link.tsx` for robust SPA route switching and race condition safety.
3. **Wallets Page Cleanup:** Verify `src/app/(dashboard)/accounts/page.tsx` lines 545-565 to ensure the redundant top button is cleanly removed while the button at line 753 remains fully functional.
4. **Goal Contributions:** Review `src/lib/goal-funding.ts` and `src/components/goals/GoalSelector.tsx` for correct goal linking in `AddTransactionModal`.
5. **Skeleton Proportions:** Check `src/components/goals/GoalCardSkeleton.tsx` and `src/components/ui/financial-summary.tsx` against loaded cards for layout parity.
