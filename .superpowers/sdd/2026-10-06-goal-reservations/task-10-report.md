# Task 10 implementation report

Date: 2026-10-07
Branch: `codex/goal-reservations`
Base: `ffc3c09`

## Implementation

- Added the explicit legacy funding review dialog and Goals card/page entry point. Unreviewed tags are not displayed as reserved money and cannot invoke spend, reserve, close, reopen, or archive shortcuts. Transaction submission also rejects an unreviewed default goal before quoting.
- Review selects current active PHP noncredit wallet reservations, status, and optional eligible historical cash expenses or cash-to-credit-card debt payments. Closed reviews create no reservations. Fake-savings copy explains normal transaction correction without an automatic reversal. Available-money validation uses decimal strings and integer cents.
- Added `adopt_legacy` to the lifecycle dispatcher. It normalizes UUIDs and array ordering, rejects malformed/duplicate entries, locks the profile before ordered goals/accounts, and checks request replay before mutable state. Reservations and spent-only imports commit atomically. Historical spending never charges the wallet again; its transaction UUID has a unique legacy import index and already-counted spending is rejected. Existing legacy tags/current amounts remain untouched. An already-confirmed goal cannot run another adoption request. Normal deletion reverses imported spending with zero restored reservation.
- Added migration 006 with reviewed column creation/metadata allowlists, denied direct transaction/event/operation DML, denied balance/ownership/account identity/lifecycle/review/archive writes, and a restrictive owner boundary. Safe account name/color/icon/order/APY/net-worth inclusion, goal target/metadata edits, and safe PHP opening wallets remain available. Wallet deletion is blocked by transaction or allocation history; allocation-backed identity changes are also blocked for privileged direct writes.
- Other public security definers and private goal/guard helpers fail closed with execution revoked from PUBLIC, anon, authenticated and service_role. Only the three public finance endpoint signatures remain callable. Trigger execution remains valid. All new helpers have pinned search paths. No missing deployed function body was guessed or created.
- Synchronized `supabase/schema.sql` with migrations 001–006 and added the 006 `.gitignore` exception approved by root. Repeated ordered migration, standalone guard/lifecycle, and reproducible-schema reapplication preserve imported history and finish with the reviewed grants.
- Audited product writers and expanded the rollout checklist with backups, statement-based debt discrepancy audit, actual function/grant inventory review, coordinated writer cutover, and forward fixes. The actual deployed deletion RPC remains explicitly unknown.
- Changed only three old database fixture inserts to privileged setup for USD/inactive wallets and closed/archived goals now denied to authenticated writers. All original financial assertions remain unchanged. The older reservation suite restores 004/005/006 afterward, keeping the disposable preview on the current dispatcher and grants.

## TDD evidence

RED database: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 1, 0 passed / 5 failed. Adoption returned `INVALID_STATE` where a successful import or `INSUFFICIENT_AVAILABLE` was expected; direct authenticated transaction insertion unexpectedly succeeded; migration 006 was absent. An initially invalid installment fixture referenced a nonexistent column; that setup error was corrected and the same five feature failures were reproduced before implementation. Credit installments are represented by credit-source transaction rows in this schema.

RED UI: `npx vitest run tests/legacy-goals.test.tsx` initially could not import the missing component. With a null component export, all four behavior tests failed because review controls were absent and the unreviewed card still exposed spending/reservation actions. After implementation, 4/4 passed. The transaction default-goal regression then failed because a quote was sent with the unreviewed goal; after the modal guard, 5/5 passed. The pending-review identity regression failed when another goal's name replaced the original pending goal; retaining and displaying the original review name fixed it, yielding 7/7.

GREEN covering run: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 0, 9/9 passed, including the final foreign-owner, ineligible-wallet, duplicate-ID and exact DML-permission assertions. This is real PostgreSQL/PostgREST with signed ordinary authenticated users, grants, RLS, race concurrency, rollback and replay. The disposable old RPC is proven callable before cutover, still exists afterward, has no execution grants for authenticated/anon/service_role, and cannot delete its selected transaction. PostgREST may deny a revoked endpoint with `42501` or remove it from the exposed cache with `PGRST202`; catalog privilege assertions independently prove revocation.

## Final verification

- `npm run test:db`, spawned with process variables from ignored `.superpowers/local-db/environment.json`: exit 0, 66 tests / 66 passed / 0 failed / 0 skipped. The final fixture-only branch assertions were then covered by the 9/9 focused run above. No application live environment was loaded or printed.
- `npm test`: exit 0, Node 2/2 and Vitest 9 files / 130 tests passed. This includes legacy review 7/7 and all prior transaction, lifecycle, Wallets, contribution and money tests.
- `npx tsc --noEmit`: exit 0.
- `git diff --check` for owned modified files: exit 0. Git emits Windows LF-to-CRLF notices; test runs emitted no runtime warnings.
- Contrast checker, using the bundled Python runtime: emerald-700/white 5.48:1, emerald-400/slate-950 10.49:1, red-700/white 6.47:1, red-300/slate-950 10.63:1, all normal-text AA passes. The first system `python` invocation was unavailable; no runtime installation was performed.
- Test users are generated and cleanup deletes only those fixture identities. The separate preview user's data was not reset. No live database, cloud credentials, push, merge, deployment, dependency installation, child agent, root progress record or root review record was changed.

## Self-review and antislop scope gate

- PASS, functional controls/states: component interaction tests cover explicit selection, insufficient funds, history errors, optional empty selection, completed review, unknown outcome retry, original pending-goal identity, and keyboard Escape with focus return. Every product entry point supplies the review handler. Confirmation is disabled during loading/errors/pending saves and changes are frozen for unknown outcomes.
- PASS, copy/data: the review uses real owner-scoped history and balances, explains old tags and fake savings, makes no fabricated security/customer/statistic claims, and adds no decorative assets, dead links, testimonials or generic marketing copy. Added copy has no em dashes.
- PASS, purpose/direction: existing Manrope/Bricolage and ENERGY 1 / RHYTHM 2 / MOTION 1 are preserved. The dialog's single confirmation accent identifies the financial commitment; bounded width and vertical scrolling follow the existing dialogs. No new layout system, gradients, icons or motion were introduced.
- PASS, source accessibility/mobile: labels associate with selects, amounts and checkboxes; clickable controls/labels have 44px minimum height, focus rings, foreground/background theme tokens, long-history wrapping, and bounded viewport dimensions. Static text color pairs pass contrast checks.
- PASS, comment scope: new SQL comments explain column-grant cleanup and fail-closed unknown-function revocation. No generic narration comments were added.
- PENDING, rendered gate: actual 375/768/1280 light/dark browser rendering and complete click-through remain with root's Task 11 gate, as instructed. Source and jsdom checks are not represented as rendered-browser evidence. Root also owns final branch lint/build.

## Files changed

`.gitignore`; `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`; `src/app/(dashboard)/goals/page.tsx`; `src/components/goals/GoalCard.tsx`; `src/components/goals/LegacyGoalReviewDialog.tsx`; `src/components/transactions/AddTransactionModal.tsx`; `supabase/migrations/202610060005_goal_lifecycle_operations.sql`; `supabase/migrations/202610060006_goal_write_guards.sql`; `supabase/schema.sql`; `tests/database/migration-security.test.mjs`; `tests/database/reservations.test.mjs`; `tests/legacy-goals.test.tsx`; this report.

## Remaining gates

Task 10 implementation and automated checks are complete. Independent review and root's Task 11 rendered/lint/build gate remain. Deployment additionally requires authorized backup/debt/schema/function/grant preflight. In particular, the real old deletion RPC is still unverified; the local fixture test does not establish its deployed name, signature or body.

## Review fix round 1: finite authenticated money writes

Independent review found PostgreSQL numeric `NaN` bypassed the opening balance's NULL/negative check. The same typed numeric domain permits `NaN` in directly editable goal target/allocation amounts. These are authenticated direct-write guards; no legacy values are automatically rewritten and privileged fixture setup remains available.

- Opening balances now explicitly reject nonfinite, null, negative and out-of-range values. Goal target/allocation guards apply on creation and when each money column is explicitly updated. Separate column triggers allow unrelated metadata/target edits to leave an untouched legacy invalid allocation intact for separate review. The trigger helper has pinned search path and no direct PUBLIC/anon/authenticated/service_role execution grants.
- Mirrored migration 006 in the reproducible schema and added the existing-invalid-money audit to deployment preflight. The typed numeric columns still determine decimal rounding; this fix makes no new promise to reject excess input scale before PostgreSQL's column conversion.
- RED: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 1 with 9 passed / 3 failed. Ordinary authenticated HTTP opening `NaN`, goal creation `NaN` target, and goal update `NaN` target unexpectedly succeeded. Each failure explicitly asserted that the write must be denied.
- GREEN: the same focused command exited 0, 12/12 passed. Tests cover both goal money columns on insert/update, `NaN`, positive/negative infinity, malformed numeric text, null, negative and overflow values, zero/positive/max finite openings, valid goal creation/target recomputation, unchanged actual/reserved balances, and retained untouched legacy invalid allocation after reapplication.
- Full final verification: `npm run test:db` with ignored disposable environment only exited 0, 69/69 passed; `npm test` exited 0, Node 2/2 and Vitest 9 files / 130 tests; `npx tsc --noEmit` exited 0. No runtime test warnings. The reservations after-hook restored current migrations and the preview user's data was not reset.
- Files: migration 006, schema.sql, migration-security tests, rollout checklist and this report. No root plan/progress/review edits, live database changes, dependencies, push, merge or deployment.

## Review fix round 2: authenticated target amounts must be positive

The scoped re-review of round 1 found that direct authenticated goal writes still accepted a zero target, although the application contract requires a positive target. Allocation-per-cycle remains allowed to be zero.

- The goal money trigger now rejects `target_amount <= 0` while retaining the existing zero-allowed allocation rule. The migration and reproducible schema contain identical `guard_goal_money` definitions.
- Added authenticated insert and update coverage for string and numeric zero targets, unchanged snapshots after rejection, a positive one-cent target, a zero allocation, and target edits that preserve existing reservations and recompute progress.
- Focused verification: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 0, 14/14 passed.
- Full native database verification: `npm run test:db` exited 0, 71/71 passed, 0 failures, 0 skipped. The command received only the ignored disposable-local database environment. The reservation suite's cleanup reapplied migrations 004–006, leaving the preview database on current migration 006.
- No TypeScript sources changed. No live project, preview account data, plan/progress/review documents, push, merge, or deployment was changed by this fix round.
