# Mobile navigation and filter verification

2026-10-08, branch `codex/mobile-pwa-follow-ups`. This verifies the current mobile presentation/recovery changes, not completion of the entire financial rollout or a production deployment.

## Root checks on final source

- `npm test`: exit 0; 20 Vitest files, 249 tests; 7 Node tests. Repeated after the final intent-cleanup refactor.
- `npx tsc --noEmit`: exit 0, no diagnostics after the production build.
- `MONETIGIA_BUILD_DIR=.next-verification npm run build`: exit 0, compiled and generated all 20 pages. Build also ran lint/type validation.
- Standalone lint exited 0; its newly introduced intent-ref cleanup warning was then removed by an equivalent effect-local invalidation helper. Final build retains five hook warnings in accounts, categories, transactions, AddAccountForm and AddTransactionModal. No unrelated hook refactor was attempted.
- Build printed outdated Browserslist notices and an edge-server SIGTERM line before successful compilation. The command still completed all build stages and exited 0; this is not a warning-free build claim.
- Scoped Sol 6.1 medium review found no remaining P1/P2 issue in recovery, final optical/label CSS or intent invalidation. Luna max handled bounded styling and mock cleanup. No Astra was used for this continuation.

## Actual browser observations

Root used the Codex in-app browser against the existing local QA preview at `http://localhost:3110`. Browser access now works; the earlier loopback limitation no longer applies to these observations.

- At 375px, a Transactions click showed the requested heading/skeleton while the URL still named Dashboard, then the destination committed normally.
- Rapid Wallets then Goals navigation showed Goals recovery while Accounts had committed. The latest requested destination remained selected and Goals subsequently arrived.
- At 375px, light and dark surfaces were inspected. The selected light neutral pill keeps the primary-green foreground; the outer capsule remains translucent. This is visual inspection, not sampled composited-pixel contrast certification.
- The filter icon appears at the far right of the mobile transaction tabs, search occupies the next row, the menu contains the two actual sort choices, and Escape returns focus to its trigger.
- Opening Add Goal hides mobile navigation; Cancel restores it. No goal or financial record was submitted or removed.
- The initial 375px capture exposed orphaned last-letter nav wrapping. Final intrinsic-width, naturally wrapping flex controls remove this problem without reducing the 12px font.
- At 320px, all five selected states were checked. Every label fit its control, all controls were at least 44px wide and 66px high, the nav remained 72px tall on one row, and document scroll width matched client width. Client width varied between 320px during loading and 305px with a classic scrollbar; both fit.
- At 1280px, the mobile nav is absent and Transactions uses its original native select. Desktop collapse remained collapsed after a roundtrip through 375px and back to desktop.
- Restored the preview's original Dark preference, reset the temporary viewport and closed the agent-created browser tab.

## Remaining acceptance

The 8-second skeleton-to-prompt transition, late commits, refresh URL targeting, modified clicks, stale exceptions/timers, modal/keyboard suppression and mounted draft preservation have automated evidence. Root did not force a real browser offline/slow-navigation condition, certify 200% text zoom, exercise a physical software keyboard, sample translucent contrast over stress backgrounds, or test physical Safari/PWA safe areas. These remain explicit QA cases.

An explicit full-document refresh can discard unsaved drafts and document-lifetime unknown-outcome controller state. The recovery code performs no automatic financial write/replay/reset. This implementation does not establish persistence of financial recovery across a browser reload.

The separate overspend popup, dated opening-debt schedule/adoption/corrections, installment selection and description editor remain pending. Landing revamp has a saved plan only. See `acceptance-inventory.md` for the full distinction between implemented, deployed and accepted.
