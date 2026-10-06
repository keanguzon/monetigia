# Goals reservations: Tasks 1–2 checkpoint

Historical October 6 checkpoint. The latest work is recorded in [Tasks 3–4 checkpoint](TASK_3_4_CHECKPOINT.md).

Execution stops after Task 2 at the user's request. Tasks 3–11 remain pending. Work is local on `codex/goal-reservations`, based on beta `6f17870`, in `C:/Users/PC/.codex/worktrees/goal-reservations/monetigia`. No push, merge, deployment, or live database migration was performed.

## Delivered scope

- Task 1 adds a reproducible additive database baseline, goal lifecycle/review fields, an immutable allocation ledger, operation idempotency records, ownership constraints, database types, and real database regression coverage. Independent review identified a service-role TRUNCATE bypass; the fix revokes that privilege and verifies rollback-preserved history. Task 1 passed scoped re-review.
- Task 2 adds decimal-string contracts and exact centavo calculations for reserved money, goal spending, combined progress, installment splits, and completion estimates. Existing projection callers remain compatible. Independent review identified excessive installment counts; the fix shares a maximum of 12 between validation and splitting, matching the current modal choices.

The new reservation lifecycle is not exposed in the app yet. Existing transaction-based goal funding and automatic completion remain until the later reader and UI tasks. These foundations do not establish atomic financial mutations or reservation limits; those belong to the pending RPC tasks.

## Verification

Fresh controller checks after the installment fix:

| Check | Result |
| --- | --- |
| TypeScript | Exit 0 |
| Vitest | 47 passed |
| Node navigation/domain tests | 2 passed |
| PostgreSQL/PostgREST integration tests | 10 passed |
| Lint | Exit 0; six existing hook dependency warnings |
| Production build | Exit 0; 20 pages generated |

Database tests used disposable local PostgreSQL 16 and PostgREST with signed authentication fixtures and real ownership/permission checks. They do not verify hosted Supabase configuration or GoTrue signup. The deployment preflight must inspect the actual deployed schema and existing transaction deletion RPC before applying migrations. No new UI was added, so responsive, contrast, and interactive reservation-flow verification remain pending.

## Decisions to retain when resuming

- Goal progress is reserved plus spending toward that goal, with the two components shown separately.
- Ordinary overspending requires an exact warning and explicit confirmation before releasing reservations. Release and expense must commit atomically in the later RPC implementation.
- Exact NUMERIC scale/range constraints reject excess decimal precision instead of silently rounding it. New API money values are canonical decimal strings; integer centavos power the pure calculations.
- Financial snapshot types override raw database money fields with decimal strings. Legacy adapters remain until the reader cutover.
- Installments must have 1–12 rows, each with a positive centavo amount; future authoritative RPCs must enforce the same bound.
- Database files run serially to avoid schema fixture interference; future explicit concurrency tests must still issue concurrent financial requests.
- Preserve old tags and financial history; users must confirm legacy reservations rather than having them inferred automatically.
- Subagent models: no Astra going forward; GPT-6-luna medium/high/extra high as appropriate, never below medium; GPT-6.1-sol low/medium, with medium as the ceiling. Choose by task complexity. Earlier agents used higher settings before this preference was set.

Implementation commits before final checkpoint documentation: `44d4bd0` (ledger), `db1e3ea` (TRUNCATE fix), `8c23f80` (approved plan/spec), `80be291` (exact summaries), and `3afa4a6` (installment cap). Task 2's scoped re-review confirmed the reported finding was addressed with no new Critical or Important breakage. Both tasks have passed independent review and local verification; no open task-review findings remain.

The plan, spec, task briefs, reports, review packages, and execution ledger are preserved for resuming Task 3. Local database fixtures and tools are ignored and must not be committed.
