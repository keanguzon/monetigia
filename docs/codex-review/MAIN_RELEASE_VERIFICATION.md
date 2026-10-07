# Main integration verification, October 8, 2026

Scope: the two manual-QA hotfixes and landing refresh on `codex/goal-reservations`, including the provider-specific OAuth loading correction. Reviewed starting commit: `f223364`; integration target is `origin/main`, superseding the earlier beta instruction. The larger existing-debt/selection/title-edit plan remains deferred.

## Changes and review

- All months Outstanding Debt uses current positive credit-wallet balances, including opening debt. Selected months retain transaction-derived Scheduled Debt. Invalid balances or pending refreshes make debt unavailable and suppress the deduction preview; no opening expense is fabricated.
- Transaction quote/save feedback sits above the fixed action footer. Only long alert text scrolls; Retry same transaction remains outside that scroller. Existing request identity and saved-but-refresh-failed protection are preserved.
- Landing explains actual/reserved/available balances and goal progress with explicitly illustrative figures, uses the existing logo, and retains the existing auth redirect and remember-me behavior. Only the selected OAuth provider now shows pending copy/spinner/busy state; both providers remain disabled until resolution.
- Resumed hotfix review resolved all four prior findings, with 56 focused tests passing. Its remaining recommendations concern additional revalidation/nonfinite regression cases, not demonstrated source defects. Landing review's one pending-copy finding was fixed and re-reviewed without new findings. See the copied review reports in `main-release-evidence`.

## Fresh verification

Final checks are recorded in `main-release-evidence`: TypeScript, full npm tests, lint, and production build. Each log contains the captured process exit code. The full suite consists of Node navigation/CSP tests plus Vitest tests; use the final logs for exact counts. Build output uses `.next-verification`, separate from the local preview cache. Lint retains five existing hook-dependency warnings. Browserslist reports stale browser data; it is a nonfatal build notice.

Final run: `npx tsc --noEmit` exit 0; `npm test` exit 0 with 7 Node tests and 201 Vitest tests across 17 files; `npm run lint` exit 0 with five warnings; `npm run build` exit 0 with 20 generated pages. The tests include the two provider-specific pending-state regressions added after landing review.

## Browser evidence and limits

- Landing checked at 375x667, 768x900, and 1280x900. Document width did not exceed viewport width. Light/dark themes rendered; sign-in and feature anchors resolved to existing sections; remember-me checkbox changed state. Sample wallet arithmetic is 57,500 minus 12,000 equals 45,500; sample goal arithmetic is 8,000 reserved plus 2,000 spent equals 10,000.
- At 375x667 the transaction dialog bounds were y=33.35..633.65; both Cancel and Add Transaction were y=571.65..617.65, within the viewport. No horizontal overflow was observed. Cancel dismissed the dialog without saving. Screenshot records the unavailable-account state, not a successful transaction.
- The local in-app browser could render pages but could not load disposable API account data in this run. Therefore current live debt totals, selected-month switching, quote/save/retry geometry with populated data, and authenticated transaction success were **not re-verified here**. Source and automated tests cover those hotfix paths; earlier browser/manual-QA evidence is historical, not a substitute for this missing check.
- OAuth provider behavior is covered with mocked requests for both providers, including pending state and cleanup. No external Google/Facebook login was completed. Physical iPhone/PWA installation and fresh database suite execution were not part of this run.

## Antislop assessment

- Hard gate: observed landing layouts fit all three widths, examples are labeled, anchors exist, and controls have real behavior. Full live-authenticated acceptance remains open as described above; no blanket gate pass is claimed.
- Purpose: green identifies the main sign-in action and available money; provider marks identify actual login providers. Existing heading/body fonts preserve the app identity. Ledger examples explain real financial concepts; no customer, performance, or security claims are fabricated.
- Liveliness: ENERGY 1 / RHYTHM 2 / MOTION 1. Headline and available-money figure provide focal points; alternating explanatory sections and financial examples establish rhythm. Motion is limited to state transitions and the selected provider's pending indicator.
- Craftsmanship: provider pending states have regression coverage; samples reconcile; existing auth redirects are retained. The browser limitations above prevent claiming exhaustive interactive acceptance.

## Integration and deployment

User authorized fresh build/typecheck followed by merge and push to origin/main. Preserve remote main history through a normal fast-forward when ancestry permits; never force push. A Git push does not apply Supabase migrations. Existing goal-reservation/installment migrations and production preflight remain separate deployment requirements; none were applied to a live database in this run.

For manual follow-up, read wallet baselines first, then compare All months Outstanding Debt against the credit wallet, toggle Deduct Debt, and confirm selected months show Scheduled Debt. Test a rejected transaction at phone width and verify its feedback and actions remain visible. Do not assume the old fixture balances.
