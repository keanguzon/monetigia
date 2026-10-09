# Monetigia landing reference revamp

Status: landing implemented locally with light/dark themes and PWA safe-area layout. Financial reset is prepared and disposable-tested; production execution needs the intended project admin access, deployed-schema comparison and backup. The selected scope is all users; wallets and settings remain.

## Agreed direction

Adapt the user's hand-held phone reference to Monetigia: pale outer canvas, white inset surface with small clipped corners, headline on the left and phone image on the right. Keep the existing green theme tokens, Manrope body and Bricolage Grotesque headings. Reduce copy and preserve Google/Facebook authentication, remember-me, safe redirect handling and theme support.

Reference: `C:/Users/PC/AppData/Local/Temp/codex-clipboard-447a9c1e-65c5-4dbf-ae55-6ee56f1101c3.png`.

Generated hero concept: `C:/Users/PC/.codex/generated_images/01a10e5e-b23c-7f41-919f-8588ef18deda/exec-1d685b29-6b96-4cbe-b130-a33197ae884e.png`.

Skills: image-to-code, design-taste-frontend, ui-ux-pro-max and project antislop. Design variance 5, motion 3, density 2; antislop energy 1, rhythm 2, motion 1.

## Image analysis and corrections

The generated 1586 by 992 hero has a pale canvas, roughly 4% horizontal inset, a white surface from y=112 to y=880, compact header, left text occupying about half the surface and a phone/hand visual filling the right third. The headline is the focal point; the green CTA is the main accent. The background waves belong to the phone visual and do not repeat behind text.

Translate the proportions rather than the image's literal oversized text: max content width about 1200px, desktop headline 56–72px with tight leading, body 16–18px, short two-line headline on a laptop, and one dominant visual. Keep all headings/navigation/buttons as real HTML.

The mockup's sample screen is illustrative and its displayed wallet balances do not explain the available amount. Correct the sample before exporting the final visual, explicitly label it Sample screen, and never use the user's private financial data. Include the actual existing logo in the implemented header. Do not ship the whole mockup as the webpage background.

## Scope and files

- Modify `src/components/landing/LandingPage.tsx`: visual structure and copy only; preserve authentication/session handlers.
- Add one focused hero visual component if needed, beside LandingPage, and approved assets under `public/landing/`.
- Extend `tests/landing-oauth-loading.test.tsx` for preserved provider loading and authentication behavior. Do not introduce a second auth implementation.
- No dashboard, finance hooks, database schema, design-token changes, dependency installs or reset execution in this task.

## Implementation units

1. Hero and navigation. Use the inspected concept, generate a separate usable phone/hand asset with coherent example values, then implement the inset shell and short headline: “Know what you can spend.” Body: “Track wallets, set aside for goals, and manage credit in one place.” Put the actual Google/Facebook sign-in controls beneath the headline. Remove top Wallets/Goals/Credit links, redundant hero CTAs and the extra sign-in heading. Keep existing sign-in anchors connected.
2. Compact explanation and sign-in. Replace the long repeated text sections with one concise explanation covering wallets, reserved goal money and credit payments. Generate a readable standalone section reference before implementing this section. Keep actual Google/Facebook actions, provider-specific loading, error feedback and remember-me. Reuse the current OAuth handlers and redirect sanitization. Avoid unsupported claims, testimonials and invented usage statistics.
3. Responsive and verification. At 320–430px, stack headline before visual; keep touch targets at least 44px and no horizontal overflow. Fit the desktop hero comfortably on a 1366×768 laptop. Use existing semantic tokens for dark mode, preserve theme controls and reduce motion when requested. Run focused landing/auth tests, typecheck and build once; visually check both themes, mobile and laptop, navigation anchors, sign-in loading/error and keyboard focus.

## Completion and next step

Execution evidence: `tests/landing-oauth-loading.test.tsx` passes 8/8 tests, including provider pending/error states, remember-me and safe redirects. Browser QA at 320px, 390px and 1366px verifies no horizontal overflow, working theme toggle, sign-in anchor and checkbox, and mobile controls at least 44px tall. Desktop hero fits within 1366×768. Real iPhone standalone Safari validation remains manual; the manifest and viewport-fit settings are preserved. No service worker/offline capability was added or claimed.

Ruling after user visual feedback: remove the misaligned HTML/SVG display overlay and grey wave backdrop. Use separate transparent hand/phone PNGs based on the supplied Goals screenshots for light/dark themes. Remove face, status bar and home indicator; use the actual app logo beside Monetigia, plain header icon backgrounds, and anonymous sample values: target 10,000, progress/reserved 1,200 (12%), savings 500/month or 250/kinsenas. Label the preview Sample screen. Also replace the actual dashboard greeting with the existing logo on the left and Monetigia text, retaining the user menu and refresh controls.

The explanation/sign-in reference was generated and inspected separately at `C:/Users/PC/.codex/generated_images/01a10e5e-b23c-7f41-919f-8588ef18deda/exec-d9bc984e-799b-49c3-9db2-a7f66a43ee9d.png`. Its flat divided rows, generous two-column spacing and stacked auth actions informed the implementation; primary buttons use project tokens instead of its darker generated green.

Record validation and commit the landing change separately from the reset preparation. After landing is complete, perform the all-users reset using `docs/codex-review/pending-rollout/financial-reset-all-users-guide.md`: verify production project and deployed schema, back up, rehearse with rollback, then perform the already requested reset at the agreed time. Preserve wallets/settings/schema and verify empty financial history, zero balances and working new transactions. Do not treat landing approval as authorization to reset immediately.


## Final image assets and prompts

Built-in imagegen edits were used; the previews are screenshot-based mockups with anonymous sample values. The actual dashboard and landing headers load the existing logo file directly.

Saved assets:
- public/landing/phone-goals-light.png
- public/landing/phone-goals-dark.png

Both PNGs are 1448×1086 with RGBA transparency. The last prompt for each theme preserved the preceding corrected logo/header/screenshot composition and changed only the mock values:

> Change ONLY mock financial numbers and progress fill in this final transparent phone PNG. Keep actual glossy green Monetigia logo, theme-colored header with no icon background boxes, anonymous avatar, app UI, hand pose, phone geometry and alpha. TOTAL TARGET ₱10,000.00. TOTAL PROGRESS ₱1,200.00. Percentage 12%. Progress bar green fills 12%. Supporting line Reserved ₱1,200.00 · Spent ₱0.00. SAVINGS TARGET ₱500.00 /mo and right side ≈ ₱250.00/ks. Everything else unchanged; preserve text style and sharpness. True transparency outside phone.

Final checks: 13/13 landing/auth and theme tests pass; final production build/typecheck pass with existing unrelated hook warnings. Browser checks verify light/dark preview assets loaded, no horizontal overflow at 320px, 390px and 1366px, and 44–48px mobile button heights. iPhone standalone installation/login remain manual device checks.
