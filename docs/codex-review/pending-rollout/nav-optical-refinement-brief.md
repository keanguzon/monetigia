# Mobile navigation optical refinement brief

## Latest user override

The earlier light .40 / dark .30 inner-pill opacities were experiments, not fixed requirements. Tune each theme's inner pill against the Apple reference's optical hierarchy and actual readability. Apple does not provide exact equivalent CSS opacity values; do not invent them. This overrides any exact opacity-preservation instruction below. Selected mobile icon and label use the app button primary green; desktop stays unchanged.

**Executor:** Luna max. **Reviewer:** Sol low/medium. **Planning:** Sol medium. User approved applying the optical research. This is a scoped CSS treatment, not a navigation, motion or financial change. No dependencies, product edits during drafting, new assets, subagents or commits.

Read current AGENTS.md and session antislop during core/UI/human/mobile/code rules. Read installed `C:/Users/PC/.agents/skills/glassmorphism-advanced/SKILL.md` as supplemental reference only: its blanket high-blur/colored-shadow prescriptions are unsuitable for the user's clearer treatment, and its agent workflow is overridden by the explicit no-subagents scope. Preserve existing product identity and current behavior.

## Research ruling

Apple describes a navigation material defined by lensing, highlights, separation and adaptive legibility. Its materials guidance distinguishes navigation from the content layer and reserves the highly translucent Clear variant for visually rich backgrounds. Monetigia financial pages need legibility rather than an imitation of native Clear material. These findings support a clearer perimeter and less scattering, while retaining protective tint; they do not supply CSS parameter values or certify browser equivalence. Sources: [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials), retrieved through its [documentation JSON](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json), and [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/).

**Feasible implementation:** CSS-only clearer center plus narrow reflective rim. This is a lens-like visual approximation, not real geometric refraction. Do not implement SVG displacement on backdrop content: that is not established here as a cross-browser Safari/Chromium solution and could distort text or fail silently. No canvas, screenshot capture, cached financial imagery, duplicate page rendering, filter URL, pointer-following lights or whole-page distortion. If genuine edge displacement is later required, that needs separate browser research and authorization; do not invent it in this task.

## Exact scope and preserved values

Modify `src/app/globals.css` only, restricted to `.mobile-navigation-surface`, its pseudo-elements and theme/support/accessibility variants. Keep component markup unchanged unless root finds a demonstrated stacking defect that cannot be solved with its existing controls' positioned stacking. `mobile-navigation.tsx` already places icons/labels above the selected indicator, and surface remains a five-column grid.

Preserve five routes, labels, routing/selected-intent work arriving from other tasks, glyphs, selected icon AND label green, indicator geometry/motion, 44px minimum targets, measured height, safe area, modal/keyboard hiding, desktop sidebar and existing reduced-motion behavior. Preserve selected inner indicator's exact supported-backdrop alpha: **light 0.40, dark 0.30**, including its current 12px blur. Do not make the inner capsule opaque, brighter or darker to compensate for an outer-surface problem.

Current outer surface: blur 24px, saturation 120%, light card alpha 0.56 and dark `hsl(220 10% 13% / 0.66)`, plus inset highlights. The approved refinement addresses that outer frosted appearance.

## CSS implementation parameters

1. Within the existing supports rule reduce outer backdrop blur **24px -> 8px**, keep saturation **120%** and matching prefixed/unprefixed declarations. Start with existing outer tints **light 0.56 / dark 0.66**. Clarity primarily comes from retained background spatial detail, not unbounded transparency. Do not blur/filter the control subtree or apply `filter` to the surface.
2. Add `position: relative` to surface if needed. `::before` is a decorative, pointer-events-none rim with inherited capsule radius, inset 0, border 1px and z-index 0; controls stay above it. Use a perimeter-only background by `background-clip: padding-box` plus transparent center or an inset border/shadow approach; no full-surface white wash. Avoid mask dependence for baseline rendering.
3. Rim light: top inset highlight white alpha **0.60**, bottom neutral shadow foreground alpha **0.10**; dark: top white **0.22**, bottom black **0.30**. Side reflections use a subtle diagonal edge gradient with maximum white alpha **0.18 light / 0.12 dark**, bounded to a 1-2px rim. Keep nonzero reflected accent confined to rim, with no green glow or rainbow band.
4. Use one existing restrained outer shadow: **0 8px 24px black/0.16 light**, **0 8px 24px black/0.28 dark**; preserve separation without the current heavy halo. One inset 1px highlight and bottom contour are sufficient. Avoid several stacked large shadows.
5. Optional `::after` may add a second static 1px highlight segment confined to the top/upper side perimeter only if the first rim is insufficient in rendered QA. No new animation, transforms, backdrop distortion, full-surface gradients or additional glass layer. Prefer the simplest single-rim result.
6. Baseline unsupported-backdrop rule remains opaque `hsl(var(--card))`, with readable border/shadow and no optical pseudo-layer requiring backdrop support. Keep blur entirely in the existing feature query. If `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, or forced-colors is detected, use opaque surface and simplify decorative reflections; forced colors uses system border/text and removes shadow. These web preferences are best-effort signals, not guaranteed exposure of every iOS setting.
7. Contrast takes precedence over outer translucency. If starting alpha fails sampled backgrounds, raise only OUTER tint to the minimum passing value, up to **0.78 light / 0.80 dark**, documenting chosen value and sampled evidence. Keep blur 8px and inner alpha 0.40/0.30. Do not silently dim all page content, recolor the selected green, or increase inner alpha. If those bounds still fail, use opaque outer fallback for the problematic accessibility mode rather than claiming compliance.

Purpose: lower blur preserves the content's shape through the capsule; narrow reflection and contour define its thickness; moderate neutral tint protects the navigation. Labels/icons remain sharp, unfiltered and stationary. A reflected edge does not mean actual background displacement was implemented.

## Verification and handoff

- [ ] Inspect current CSS before editing so latest root changes survive. Apply only scoped rules above. No tests mirroring literal CSS values; verify geometry and rendering directly.
- [ ] Run existing `npx vitest run tests/mobile-navigation.test.tsx tests/mobile-navigation-visibility.test.tsx tests/sidebar-breakpoint.test.tsx` and `npx tsc --noEmit`; existing routes/focus/visibility tests remain passing. If later navigation suites have changed, run current matching suites without overwriting them.
- [ ] Root screenshot/browser comparison at 320/375/768px, both themes: neutral empty background, rows/text scrolling beneath, bright card and dark section beneath. Show visibly clearer outer detail and restrained perimeter versus prior 24px frost. Confirm inner alpha unchanged, selected icon+label green, no filtered glyphs, no clipped focus, 44px targets, no overflow and exact safe-area clearance.
- [ ] Sample actual composited pixels adjacent to normal/selected label strokes in each stress background and calculate contrast against computed foreground color using installed antislop contrast checker. Normal 12px labels require **4.5:1**; icons/focus indications require **3:1** against adjacent surface. Include selected green and darkest/brightest plausible backgrounds; computed CSS alpha alone is insufficient. Adjust outer tint only under rule 7 and record final value. Keep evidence screenshots private to the local review flow, never cache page imagery as product rendering input.
- [ ] Check unsupported-backdrop fallback by disabling support rules in a disposable preview, reduced-transparency/contrast where supported, forced colors, reduced motion, keyboard focus and desktop unchanged. Confirm no moving optical effect or motion reintroduced.
- [ ] Sol low/medium reviews diff scope and rendered evidence; root runs integrated lint/build when incorporating change. Record exact browser/version/device coverage and selected CSS parameters. No commit/push unless root instructs it.

## Limits

CSS blur and rim reflections approximate perceived glass; they do not reproduce Apple's native adaptive optical pipeline or genuine refraction. Safari/iOS compositing and accessibility preference exposure require physical-device acceptance. Static contrast samples support only the tested backgrounds; this design uses a protective tint/fallback rather than claiming automatic background-dependent contrast adaptation.
