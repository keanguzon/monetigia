# SDD ledger - plan: docs/superpowers/plans/2026-10-06-goal-reservations.md

Start commit: 6f17870; isolated branch: codex/goal-reservations.
Baseline: npm test exit 0, 2 Node tests and 10 Vitest tests.
User-approved: combined reserved + spent progress; subagent task review; no push before final check.

## Preflight scan

| Task / interface pair | Check | Result |
|---|---|---|
| Task 1 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 2 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 3 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 4 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 5 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 6 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 7 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 8 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 9 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 10 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 11 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| 1/3 schema and RPC types | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/4 transaction rows and owner keys | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/5 lifecycle and event reversal keys | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/10 migration and restricted permissions | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 2/3 amount and snapshot contracts | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 2/6 pure totals and projections | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/4 shared apply RPC and deterministic locks | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/5 shared apply RPC and idempotency | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/6 snapshot shape and transport | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/5 transaction reversal references | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/6 quote and command contracts | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/8 quote confirmation and retry | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/7 lifecycle actions and goal status | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/8 transaction deletion command | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/10 lifecycle migration and legacy adoption | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/7 use-goals snapshot and components | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/8 transport and shared financial refresh | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/9 cache and wallet snapshot | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 7/8 Spend shortcut and AddTransactionModal | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 7/10 legacy card actions and goals page | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 8/10 AddTransactionModal and legacy safety | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 9/10 balance writer removal and grants | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |

## Local environment

Disposable native PostgreSQL/PostgREST provisioning under investigation. Live .env must not be used for writes. No service-role key found in local environment.

## Tasks
Task 1: pending; Task 2: pending; Task 3: pending; Task 4: pending; Task 5: pending; Task 6: pending; Task 7: pending; Task 8: pending; Task 9: pending; Task 10: pending; Task 11: pending.

Ruling: Use native local PostgreSQL + PostgREST for financial integration tests, with direct-SQL auth fixtures and signed JWTs - no local Supabase stack is installed and real locks/roles are required - this does not verify GoTrue signup or hosted Supabase-specific deployment configuration.
Ruling: Store ledger deltas as exact NUMERIC with explicit two-decimal scale and numeric(15,2)-equivalent range checks - fixed-scale NUMERIC silently rounds invalid 1.001 inputs before constraints inspect them - requires matching validation in RPCs and documented schema types.
Ruling: Run database test files serially with --test-concurrency=1 while explicit race tests issue concurrent requests - schema and permission migration tests share the disposable database - slightly slower suite, avoiding test infrastructure races without weakening concurrency assertions.

User steering: stop after Task 2 (including independent reviews). Tasks 3-11 must not be dispatched. Retain workspace/ledger for resume.
Task 1: implemented at 44d4bd0; awaiting independent review.
Task 1: fix round 1/5 started; Important open: service_role TRUNCATE privilege bypasses immutable event trigger; review head 44d4bd0.
Task 1 cross-task item: live schema/deletion RPC inspection remains a documented deployment preflight; no live migration/push is authorized.
Ruling: Retain legacy funding helper exports until Task 6 reader cutover and permit only a projection delegation wrapper in use-goals during Task 2 - existing modal/hook callers must keep working at this partial stopping point - legacy transaction-based UI behavior remains until the rest of the plan is executed.
Task 1: fix round 1/5 implemented at db1e3ea; TRUNCATE denied and rollback-preserved history test added; awaiting scoped re-review.
Ruling: Finance snapshots override Goal row monetary properties with decimal-string types - inheriting numeric database row properties contradicted exact-money API boundaries - downstream hook/display adapters must consume the clarified DTO rather than assume raw table types.
Task 1: fix round 1/5 (1 addressed, 0 open; commits 44d4bd0..db1e3ea; independent re-review clean).
Task 1: complete (commits 6f17870..db1e3ea, review clean; deployed-schema preflight explicitly deferred to deployment).
Task 2: implementing; base 8c23f80; fresh task_2_summary implementer.
Ruling: Expand Vitest discovery minimally to .test.ts and .test.tsx - existing config excludes the planned pure TypeScript tests - more TypeScript tests become discoverable, Node .cjs/.mjs suites remain separate.
Task 2: implemented at 80be291; pending independent review.
User asked about lower-tier subagents; preference question pending. Routine Task2 review candidate gpt-6-luna; sensitive SQL review gpt-6.1-sol default if chosen.
Controller verification at 80be291: npx tsc --noEmit exit0; npm test2Node+44Vitest exit0; npm run test:db10/10 native PostgreSQL/PostgREST exit0.
Model assumption while preference question is unanswered: use gpt-6-luna high for the remaining routine Task2 review; retain gpt-6.1-sol for sensitive SQL reviews on future resume. This is a controller default, not a submitted user selection.
User model preference confirmed: GPT-6-luna xhigh for routine work/testing/review; GPT-6.1-sol medium for task implementations going forward.
Task 2: independent review dispatched to review_task_2 (gpt-6-luna xhigh), head80be291.
Controller final local checks at80be291: npm run lint exit0 (six exhaustive-deps warnings in unchanged source files); npm run build exit0 (20 static pages generated; existing font fallback, Supabase Edge API, Browserslist/cache warnings).
Task 2 review remains pending; all product files are unchanged since reviewed head80be291. No Task3+ dispatched.
User final model policy: no Astra; GPT-6.1-sol only low or medium, medium is highest allowed; GPT-6-luna xhigh when capable. Controller chooses role by complexity/value, not all-Luna or all-Sol. Overrides prior skill model-tier recommendations.
Task 2 review Important open: installment count up to billions can allocate enormous arrays; fix practical cap matching current modal validation in both draft schema and helper.
Ruling: Cap installments at 12 using the existing modal choices (1..12) and one shared schema/helper constant - valid counts in the billions can exhaust memory before any financial write - longer repayment plans would require an explicit coordinated UI/API policy change.
Task 2 fix round 1: use fresh Luna xhigh fixer instead of resuming original Sol high implementer - user now prohibits Sol above medium and requests value-based model routing.
User refinement: Luna reasoning floor medium; choose medium/high/xhigh as needed, not always xhigh. Sol remains low/medium only; no Astra. Use value-based role/task judgment.
Controller fresh verification after installment fix: npx tsc --noEmit exit0; npm test 47 Vitest + 2 Node exit0; npm run test:db 10/10 native PostgreSQL/PostgREST exit0; npm run lint exit0 (same six pre-existing exhaustive-deps warnings); npm run build exit0, 20 pages generated. Scoped fix review still pending; no Task3+ work.
Task 2: fix round 1/5 (1 addressed, 0 open; commits 80be291..3afa4a6; scoped Luna medium re-review clean).
Task 2: complete (commits 8c23f80..3afa4a6, review clean; fresh TSC/tests/database/lint/build checks recorded above).
Review process note: scoped reviewer appended its verdict to the ignored report despite read-only instructions; no product/index/branch mutation occurred, and controller instructed no further edits. Verdict also returned in final message.
Requested stopping boundary reached: Tasks 1-2 complete; Tasks 3-11 pending. Preserve worktree, plan workspace, and local test fixtures for resume. No push, merge, deployment, or live database migration.
User resumed local implementation on 2026-10-07, superseding the prior stop-after-Task2 boundary. Continue Tasks3-11 with task-scoped independent reviews, existing model ceilings, and no remote push/merge/deployment/live migration.
Task 3: implementing; base4fbf4ba; use Sol medium for security/concurrency SQL work. Existing isolated worktree and disposable local database are reused.
Ruling: Snapshot goals retain archived entries with archive metadata to resolve historical names; active presentation filters archived/closed entries in later reader/UI tasks - the shared snapshot has one goals array and cannot both erase archived names and retain them for history - consumers must explicitly apply the active filter.
Task 3: implemented at fff3e0b; reported24/24 real database tests and TSC exit0; independent Sol medium review pending.
Controller fresh app regression check atfff3e0b: npmtest exit0,47Vitest+2Node, no failures. Task3 independent review pending.
Task3 cross-task review checks resolved: quote/confirmation belongsTask4; lifecycleTask5; activeUI filteringTasks6-7; directwriter cutoverTask10. Not missing withinTask3 scope.
Task 3: complete (commits4fbf4ba..fff3e0b, independentSol medium review speccompliant/qualityApproved, nofindings).
