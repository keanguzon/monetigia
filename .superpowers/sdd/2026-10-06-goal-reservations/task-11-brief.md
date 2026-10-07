# Task 11: Whole-flow verification and delivery evidence

## Required outputs

Create `docs/codex-review/GOAL_RESERVATIONS_VERIFICATION.md`. Update rollout guide and the plan's completed checkboxes only for checks that actually pass. Use this isolated checkout and existing disposable local environment; do not read/load the application's live `.env` or write to a live database.

## Required sequence

1. Run, in order, `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run lint`, and `npm run build`. Record exact exit codes and test/page counts. Fix newly introduced failures; identify pre-existing lint findings precisely, and never label lint as passing when it is not. Database tests must exercise real permissions, locking, rollback and replay.
2. Using only the disposable local seeded account, exercise the acceptance lifecycle: reserve 500 toward 5,000 (10%); Laptop reserve/spend/complete; Date under-budget completion with release and move choices; emergency release; user-confirmed 28,000 expense overspend; multiple goals and stale quote; cancel/failed save; installment/debt payment; transaction reversals; legacy adoption; archive/reopen. Preserve existing test fixtures or restore only through supported disposable-fixture cleanup. Never mutate production or real user data.
3. Verify screens at 375px, 768px and 1280px in both themes: page headings, summary and skeleton alignment; long names and large amounts; horizontal overflow; contrast; pending/error/empty states; keyboard Tab/Enter/Escape focus; reduced motion. Check cached/cold navigation regressions against existing navigation tests.
4. Produce concrete antislop delivery evidence for Hard Gate, Purpose Gate, Liveliness and Craftsmanship; report one-line reasons for hierarchy, typography, spacing, goal-card actions, emerald feedback and dialogs. Do not claim browser-rendered results based only on source or test inspection.
5. Review the complete branch against the approved design spec and the five Review Focus risks in the plan. Record limits honestly, including unknown deployed deletion-RPC inventory. Commit only the verification artifact/documentation within this worktree. No push, merge, production deployment or live migration.

## Known issue at Task 10 handoff

Authenticated disposable preview now loads Dashboard/account data and Wallet tiles. Wallets' `goal_finance_snapshot` request returns HTTP 200 while its summary displays `Unavailable`. Diagnose this first using systematic debugging. If this is a product defect in scope, add a regression test that fails before the fix, then implement the narrowest fix and verify it. If caused by the ignored preview harness/data, fix only that disposable harness. If unresolved, document exact evidence and do not claim acceptance passed.

## Binding design constraints

Use the approved spec `docs/superpowers/specs/2026-10-06-goal-reservations-design.md`: exact decimal money, atomic authenticated writes, no double-counted transactions, PHP active non-credit wallets only for reservations, no automatic legacy reinterpretation, actual/reserved/available scope aligned, credit debt kept separate. Keep visual direction Manrope/Bricolage, restrained emerald, Goals-summary reference, ENERGY 1 / RHYTHM 2 / MOTION 1, both themes, keyboard, reduced motion, and the three specified viewports. No deployment is part of this task.

## Completion boundary

This is Task 11 and the final task. Do not start follow-on work. The user explicitly authorized continuing after the previous stop-at-Task-10 boundary, but still forbids remote push until a final check. Keep all changes on `codex/goal-reservations`.
