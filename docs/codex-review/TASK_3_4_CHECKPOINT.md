# Goals reservations: Tasks 3–4 checkpoint

October 7, 2026. Stopped after Task 4 at the user's request. Tasks 1–4 have passed independent task review; Tasks 5–11 remain pending. No push, merge, deployment, or live database migration was performed.

Worktree: `C:/Users/PC/.codex/worktrees/goal-reservations/monetigia`.
Branch: `codex/goal-reservations`.

## Delivered

Task 3 adds owner-scoped `goal_finance_snapshot` and atomic reserve/release/reallocate commands. Exact amounts come from allocation history. Setting aside money changes neither actual wallet balances nor financial transactions. Profile-first locking serializes a user's financial mutations, and stored request results prevent duplicate allocations. Archived goal metadata is retained for history; active presentation filtering belongs to the pending reader/UI tasks.

Task 4 adds read-only transaction quotes and atomic booking with explicit confirmed releases. The PHP 30,000 actual / 5,000 reserved / 28,000 expense case ends at 2,000 actual / 2,000 reserved / 0 available, with no unrelated goal spending. Custom releases must match the exact shortfall in the paying wallet. Stale quotes write nothing. Matching completed requests replay before stale-quote rejection. Goal expenses consume their own reservation; transfers carry backing without creating new goal progress. Credit signs, monthly debt-payment rules, and installment scheduling are preserved; centavo splits book debt once.

Migrations through `202610060004_goal_transaction_operations.sql`, typed RPC entries, ordered schema provisioning, and real database tests are committed locally. Task 3 commit: `fff3e0b`. Task 4 commit: `eff835d`. Test-only race coverage follow-up: `2ee49eb`.

## Review and verification

Task 3 independent review: spec compliant / Approved, no findings. Task 4 independent review: Approved, with one recommendation to assert the full persisted race outcome. The test now verifies exact winner-dependent balances, operation/event/transaction counts and linkage, returned IDs, and absence of losing side effects. Scoped re-review confirmed it addressed the finding without new breakage. No open task-review findings remain.

| Check | Result |
| --- | --- |
| TypeScript | Exit 0 |
| Vitest | 47 passed |
| Node navigation/domain tests | 2 passed |
| PostgreSQL/PostgREST integration tests | 36 passed, zero failures/skips |
| Lint | Exit 0; six existing hook dependency warnings |
| Production build | Exit 0; 20 pages generated |

The controller ran application, type, lint, build, and database checks at `eff835d`. After the test-only follow-up, the controller reran all 36 database tests at `2ee49eb`. The follow-up changed only the test and its report; production source was unchanged. Lint warnings remain in the existing Accounts, Categories, Settings, Transactions, AddAccountForm, and AddTransactionModal files, which Tasks 3–4 did not modify. The build logged a nonfatal edge-worker SIGTERM message before successful compilation and exit 0.

Database tests use disposable local PostgreSQL 16 and PostgREST with signed auth fixtures, real role permissions, locks, rollback, and HTTP RPCs. They do not verify hosted Supabase configuration or GoTrue flows. Tests clean up fixture users. Because earlier tests reapply migration 003, the controller restored the full ordered schema through 004 after the final suite.

## Partial completion boundaries

The existing app UI is not connected to the new reservation/transaction RPCs yet. The old funding reader, transaction writers, and UI behavior remain until their owning tasks. Lifecycle/reversals (Task 5), typed transport and cache refresh (6), goal actions (7), transaction release UI (8), wallet presentation (9), legacy review and permission cutover (10), and rendered whole-flow verification (11) remain pending.

Do not deploy this partial branch as the coordinated writer/permission cutover. Obtain the actual deployed schema, deletion-RPC inventory, and debt audit before deployment preparation. No production reservation integrity or complete user-flow verification is claimed at this stopping point.

## Resume

Read the plan, spec, and `.superpowers/sdd/2026-10-06-goal-reservations/progress.md`. Tasks 1–4 are complete; do not repeat them. Resume at Task 5 only when the user requests continuation. Preserve the worktree, reports, review packages, and local fixtures.

Subagents: no Astra; Luna medium/high/xhigh, never below medium; Sol low/medium, with medium as the ceiling. SQL financial implementation and review used Sol medium; the narrow race-test fix and scoped review used Luna medium. No child agents were dispatched by those workers.

The transfer ZIP produced on October 6 contains the earlier Task 2 checkpoint. A future transfer must export a new bundle to include this work.
