# Mobile navigation optical refinement report

## Changes

The mobile capsule retains its 8px outer blur, 120% saturation, light tint 0.56, dark tint 0.66, and theme-specific shadows. The decorative pseudo-element no longer paints a gradient or tint across the capsule interior. Its center is transparent; the outer capsule border and thin top and bottom inset contours provide the edge treatment. No mask or displacement effect is used.

The selected mobile icon remains `hsl(var(--primary))`; the user later chose icon-only navigation, so no mobile labels are rendered visibly. The light selected pill is pale neutral glass: supported backdrop-filter browsers use `hsl(var(--muted) / 0.48)` with the existing 12px blur, while unsupported backdrop-filter, reduced-transparency, and increased-contrast modes use opaque `hsl(var(--muted))`. No light-mode accessibility fallback restores a dark pill. Dark-theme selected styling is unchanged, including its existing 0.30 supported-backdrop fill. The user's pale-pill preference takes precedence over the earlier dark-neutral contrast experiment.

The later QA-11 decision supersedes the earlier natural-wrap layout: mobile navigation now uses five equal grid slots in one row at all mobile widths, with visible labels removed and accessible route names retained on each link. At widths up to 420px the capsule uses 4px outer margins, no column gap and 2px inner padding. The existing `ResizeObserver` measures the surface and updates page clearance; controls keep at least 44px targets. Root measured 24px icons and equal slot widths at 320px, 375px, and 412px.

The sidebar breakpoint test mock now removes `navigationSource` before spreading props onto its anchor, avoiding an invalid DOM-property warning. Navigation intent invalidation now uses one named helper for both `popstate` and effect cleanup; it increments the current ref value and clears the ref-cleanup lint warning.

## Verification

- `npx vitest run tests/mobile-navigation.test.tsx tests/mobile-navigation-visibility.test.tsx tests/sidebar-breakpoint.test.tsx tests/navigation.test.tsx tests/mobile-navigation-recovery.test.tsx` passed: 5 files, 34 tests.
- `npx tsc --noEmit` exited 0.
- `npx eslint src/components/layout/navigation-provider.tsx` exited 0 with no warnings.
- PostCSS parsed `src/app/globals.css`; `git diff --check` exited 0 for the scoped files.
- Contrast checker: the required light primary green icon `#16A34A` is 3.01:1 against the opaque light muted token (`#F1F5F9`), just above the 3:1 non-text target. The pale translucent pill varies with the surface beneath it, so final per-pixel icon contrast depends on the underlying surface. The mandated green was not darkened. Dark `#22C55E` on dark muted `#1E293B` is 6.42:1.

These are solid-color calculations, not samples of final browser-composited pixels around icon strokes. Root's latest live browser review measured five equal mobile nav slots at 320px, 375px, and 412px with no horizontal overflow and reviewed both themes. Recovery-state live screenshot review remains open.

## Limits

This change simplifies the rim to the perimeter and does not implement geometric refraction or Apple's proprietary material pipeline. The latest icon-only single-row nav does not need label-fit reflow; the recovery state still needs live browser review. This pass did not verify a physical Safari/iOS device or production build. Reduced-transparency and contrast media features remain best-effort browser signals.
