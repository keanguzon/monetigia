# Pending Rollout Verification

## Follow-up baseline and browser evidence

Implementation baseline after the bounded Task 9 review fix: `f26b845`. Sol 6.1 medium's single integrated review found one count-one literal-suffix editor issue and identified missing multi-page refresh coverage. The fix derives original count/ordinal from the owned original financial operation; no SQL or financial hook changed. Affected suites passed history 28/28, editor UI 2/2 and page 12/12. Typecheck and the post-change isolated production build exited 0. No additional full test or database batch was needed for this UI/history-only fix.

Root used a fresh disposable identity in the current-repository development preview on localhost:3107 with Edge. Existing users and financial data were preserved. Browser evidence:

- Created a credit wallet with 24-row PHP 2400.00 and 2-row PHP 400.00 opening debts. Outstanding became PHP 2800.00; cash remained PHP 30000.00. Actual PHP 100.00 payment reduced debt to PHP 2700.00 and cash to PHP 29900.00; the first two-month row retained paid 100.00 and remaining 100.00.
- Created a PHP 1200.00 three-payment purchase. Group title editing updated the confirmed header while remaining stayed PHP 1200.00.
- Forced an edit to commit, then aborted its response. After Wallets/Transactions route remount, Retry same edit sent the same request UUID (two captured calls) and retained the multiline draft. Confirmed title updated.
- Forced a correction response loss after successful local commit. Cross-page recovery completed; the selected group's PHP 300.00 unpaid remainder became zero, total debt changed PHP 3900.00 to PHP 3600.00, and cash remained PHP 29900.00. The scripted dialog assertion timed out because the page recovery button retried directly; request-identity/count was not captured for this case and is not claimed.
- Overspend popup Keep reservations returned to the form. Release funds and save released only PHP 100.00 from a PHP 1000.00 reservation; the goal showed PHP 900.00 reserved and PHP 0.00 spent. Ordinary multiline description edit updated both detail and list without changing the PHP 29000.00 transaction amount. Native Ctrl+A selected the whole textarea; Escape returned focus to Edit description.
- Completed and archived a goal, restored it through profile Settings, verified it remained closed, and then explicitly reopened it. All five mobile destinations reached their actual routes.
- Captured Transactions at 320/375/768/1280 in both resolved themes with reduced motion. No horizontal overflow; group Edit description measured 44px high. Screenshots are under pending-rollout/screenshots/task9-transactions-*.png. Actual computed text/background samples: heading 19.12/20.01, muted copy 7.80/4.76, primary button 8.85/6.12, edit button 19.12/20.01 (dark/light contrast ratios).

Remaining rendered acceptance is explicit: full forced-unknown adoption, genuine target/search-disappearance browser recovery, all control/focus-boundary contrast, safe-area/keyboard behavior and true browser 200% zoom. A CSS `html.style.zoom=2` experiment produced overflow and is not accepted as a true browser zoom result. Physical Safari/Home Screen and production 10–15-second tab-return remain pending. Production migration 080006 has not been applied or deployed in this session. Task 9.1 is green; Task 9.2 has the evidence above but is not a complete device/release sign-off.

Antislop evidence: Hard/Purpose/Liveliness/Craftsmanship checks pass for the captured transaction surfaces and exercised controls (real actions, no fabricated content, preserved green identity, existing typography, ENERGY 1/RHYTHM 2/MOTION 1). Full accessibility/device gate remains pending on the explicitly listed checks; do not describe this as complete production acceptance.

Run date: 2026-10-09 (Asia/Taipei). This is the Task 9.1 check-only baseline. No source, test, migration, or handoff files were edited for these checks. No commit or push was made.

## Baseline

- Branch: `beta-1.1`; HEAD: `495465c2711e7bd225d921ea1552f39a00ba5ba7`.
- Task 6 gate: `50bf060`, `26a1e80`.
- Reviewed task SHAs: 7.1 `e6888d3`, 7.2 `2bdd3e0`, 8.1 `d7714f3`, 8.2 `495465c`.
- At the start, the worktree already contained modified `tsconfig.json` and untracked `.playwright-cli/`; both were preserved. During the batch, `docs/codex-review/pending-rollout/screenshots/` and `docs/codex-review/pending-rollout/task-8-2-review.md` appeared and were left untouched. The portable handoff was preserved.
- Full command logs are in ignored `.superpowers/qa-current/task9-*.log` files.

## Fresh checks

| Command | Exit | Result |
| --- | ---: | --- |
| `npx tsc --noEmit` | 0 | No diagnostics. |
| `npm test` | 0 | Node tests: 7 passed, 0 failed. Vitest: 36 files and 429 tests passed, 0 failed. |
| `node .superpowers/qa-current/run-db-suite.mjs` | 0 | The wrapper ran `npm run test:db` with its guarded local disposable environment. Native DB tests: 135 passed, 0 failed, 0 skipped, 0 todo; duration 118.5 seconds. |
| `npm run lint` | 0 | No lint errors. 20 `react-hooks/exhaustive-deps` warnings about missing effect dependencies. |
| `MONETIGIA_BUILD_DIR=.next-verification npm run build` | 0 | Production build completed and generated all 20 static pages. The prior environment value was unset and was restored to unset. Details below. |

The lint warnings were reported at `accounts/page.tsx` (3), `categories/page.tsx` (1), `transactions/page.tsx` (2), `AddAccountModal.tsx` (2), `DebtHistoryGroup.tsx` (1), `LegacyDebtReviewDialog.tsx` (2), `AddAccountForm.tsx` (2), `AddTransactionModal.tsx` (1), `DebtCorrectionDialog.tsx` (3), `InstallmentHistoryGroup.tsx` (1), and `TransactionDescriptionEditor.tsx` (2). The build repeated the same 20 hook warnings. It also printed `Compiler edge-server unexpectedly exited with code: null and signal: SIGTERM`, then reported `Compiled successfully`; Browserslist printed two stale `caniuse-lite` notices (browser data 10 months old / package outdated). The build completed with exit 0.

## Final disposable database runtime

The test helper installs every numeric SQL migration in filename order. The full suite ran `installment-final-state.test.mjs` before the later ledger, migration-security, reservations, and transaction-description suites. After the full suite, I ran `installment-final-state.test.mjs` once more against the same guarded local disposable harness; it exited 0 with 6/6 tests passing. That final pass verified the installed runtime after all suites and left the complete sorted migration set installed through `202610080006_transaction_description.sql`:

1. `202610060001_runtime_baseline.sql`
2. `202610060002_goal_allocation_ledger.sql`
3. `202610060003_goal_reservation_operations.sql`
4. `202610060004_goal_transaction_operations.sql`
5. `202610060005_goal_lifecycle_operations.sql`
6. `202610060006_goal_write_guards.sql`
7. `202610070001_installment_purchase_dates.sql`
8. `202610080001_archived_goal_restore.sql`
9. `202610080002_existing_debt_creation.sql`
10. `202610080003_debt_settlements.sql`
11. `202610080004_debt_corrections.sql`
12. `202610080005_debt_snapshot_adoption.sql`
13. `202610080006_transaction_description.sql`

No production environment or database was used, reset, or migrated.

## Review and browser notes at this baseline

The integrated review identified a P2 count-one literal suffix editor baseline issue; root scoped a bounded Task 8.2 follow-up for it and two narrow history-page coverage gaps. Those changes are outside this check-only batch. Re-run the full typecheck if that source unit changes.

Root's two-call browser check confirmed that an unknown committed description edit remained recoverable after remount with the same UUID. A separate unknown correction attempt returned non-OK while the DB batch was reinstalling older definitions; it is not counted as product acceptance. Root paused further financial browser checks and resumed them only after the final runtime restore. A later correction-flow UI check confirmed that the unpaid PHP 300 row was removed, wallet cash remained PHP 29,900, and group remaining debt was PHP 0. The UI replayed from its in-banner Retry; the browser script's expectation of a dialog was incorrect, and it did not capture request identity or retry count, so no same-request/count claim is made.
