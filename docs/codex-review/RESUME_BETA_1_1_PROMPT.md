I'm moving this Monetigia project to a new PC. This handoff is for project context and the existing roadmap; I will make a fresh plan with you after the transfer. Do not start coding or choose agents/models yet.

First read `AGENTS.md`, `docs/codex-review/BETA_1_1_HANDOFF.md`, and `docs/superpowers/plans/2026-10-08-pending-rollout.md`. Check the actual branch, diff, and files before trusting old checklists. The detailed debt implementation plan is `docs/superpowers/plans/2026-10-07-existing-debt-selection.md`; use its task briefs under `docs/codex-review/pending-rollout/` for exact scope and contracts.

## Roadmap checkpoint

- **Done; don't reimplement:** mobile/PWA navigation, mobile sort/filter and loading recovery (`7c5b18a`, user QA accepted); overspend Keep/Release popup (`cb402e4`); exact opening-debt schedule helper (`ef9282a`); opening-debt creation backend (`98bffb7`); debt money helper, private adapter/storage and payment/reversal integration (`ace3917`, `c34d6b4`, `b2dd9a2`); archived-goal Settings UI/restore implementation (`a61b0f1`).
- **Current checkpoint:** Task 5.2a correction contracts are committed (`b316c40`). Task 5.2b atomic unpaid-debt correction handler, dispatcher integration and DB tests are committed in beta-1.1, but still need independent review. Its focused report is `docs/codex-review/pending-rollout/task-5-2b-report.md`. No production SQL was run for 5.2b.
- **Next roadmap items:** review 5.2b; Task 6a debt snapshot/legacy balance adoption and durable client state; Task 6b existing-debt fields in Add Wallet and standalone account creation, including fixed footer; Task 7 stable-ID installment selection, select-all/range selection and full-row correction states; Task 8 guarded transaction/group title or description editing that cannot alter money; Task 9 integrated regression/build/release checks and production migration/RPC verification.
- **Release checks still open:** verify production RPCs/migration order for archived-goal restore and opening-debt creation; integrated checks for pending tasks; physical iOS Safari/PWA checks; production tab-return behavior after 10–15 seconds. Local desktop tests do not prove those device/production checks.
- Landing-page redesign is deferred until this pending rollout is finished.

## Constraints to retain

Preserve all existing records, including QA/dummy data. Never reset a database or invent historical purchases/payments. Opening debt stays separate from expense history. Keep whole-number installment counts (including 2, 24, and 600), due dates, exact centavo totals, dated FIFO payment allocation, and corrections limited to selected unpaid rows in one debt group. Preserve paid history and cash; don't invent reimbursements. Run database tests only against the disposable local DB. Follow the repo's migration-before-dependent-frontend rollout order.

This is only the roadmap handoff. After reading it, tell me the checkpoint in a few lines and wait while I make the new plan. Do not implement anything until I ask.
