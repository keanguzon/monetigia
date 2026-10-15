### Task 8: Full verification and QA evidence

- [ ] `npm test` (node tests + full Vitest). Expected: all pass.
- [ ] `npm run test:db`, sequentially, against the disposable DB. Expected: all pass, including the existing suites (proves no regression in debt/goal flows).
- [ ] `npx tsc --noEmit` and `npm run build`. Expected: exit 0.
- [ ] Manual click-through (antislop R-35), recorded element by element in a report under `docs/codex-review/`: period prev/next/menu, All time, summary Retry, Set/Edit/Remove limit, dialog Escape. Check light and dark themes at 320, 375, 768 and 1280 px, with screenshots in the same folder pattern as `docs/codex-review/pending-rollout/screenshots/`.
- [ ] Contrast check on the over-limit text and the progress bar in both themes, using the `antislop-human` contrast checker.
- [ ] Cross-check: the Dashboard's "This month" Expenses equals the Transactions summary "Spent so far" for the same account.
- [ ] **Release gate (from Q2, corrected Oct 15):** production installation through `202610090001_transaction_metadata.sql` was user-reported as successful. Before deploying, do a read-only, catalog-level check that live functions, grants and tables match the ordered migrations (function existence, `EXECUTE` grants, and the debt/metadata dispatcher branches). Then apply `202610140001_spending_summary.sql` and `202610140002_spending_limits.sql` in that order from `supabase/migrations/` (never via `schema.sql`), and run the same catalog check for the two new objects. Deploy the frontend only after both succeed and this task's QA passes. Record the check results and applied order in the QA report. Nothing in this plan applies SQL to production on its own; the user (root) does it. Physical Safari/PWA acceptance stays on the rollout track and isn't part of this gate.

---

## Out of scope (deliberately)

- Payday-to-payday periods (unless you pick it in Q1)
- Per-category limits, limit history, rollover, notifications
- A separate Budgets page or sidebar item
- Any change to Goals, reservations, debt, or the transaction write commands
- Recurring or fixed expenses

## Verification summary

| Layer | Command | Proves |
|---|---|---|
| Period math | `npx vitest run tests/spending-periods.test.ts` | Device-local boundaries, Feb/leap/year rollover |
| SQL totals | `npm run test:db` | Rules, completeness past 1000 rows, owner isolation |
| Hooks | `npx vitest run tests/spending-hooks.test.tsx` | Keys, revalidation, error handling |
| UI | `npx vitest run` | States, copy, keyboard, limit table |
| Types/build | `npx tsc --noEmit`, `npm run build` | Compiles |
| Manual | Click-through report + screenshots | Real behavior, mobile, both themes |
