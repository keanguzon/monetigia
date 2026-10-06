# Task 3: Atomic reservation operations

Status: DONE

## Implementation

Added `goal_finance_snapshot()` and reserve/release/reallocate branches of `goal_finance_apply(uuid,jsonb,jsonb)`. Both are security definers scoped by `auth.uid()`, with pinned `pg_catalog,public` search paths, owner predicates, anonymous execution revocation, and identity-less caller rejection.

Apply requires positive canonical bounded decimal strings, exact supported command fields, eligible owned wallets, confirmed active/unarchived goals, and sufficient funds. Unsupported commands/non-null quotes fail explicitly. It locks the existing profile row, then owned goals in UUID order, then owned accounts in UUID order. Lifecycle/fund validation follows locks. Operation, event changes, and stored result commit atomically. Matching completed requests replay the original result even after lifecycle changes; conflicting commands fail `REQUEST_CONFLICT`.

Snapshot derives amounts in one coherent CTE query using PostgreSQL numeric arithmetic and canonical two-decimal strings. It returns per-wallet actual/reserved/available funds and per-goal reservations/spending/progress/breakdowns. Per the binding controller/ledger ruling, it includes archived metadata for historical names; later UI callers filter `archived_at`. Expense/transfer legacy tags contribute only `legacyTaggedAmount` for `needs_review`; confirmed goals return null. Tags never become allocations or progress.

## TDD and verification evidence

RED, before production SQL existed:

`node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/reservations.test.mjs`

Exit 1; 12 tests, 0 passed, 12 failed. Primary failure: `PGRST202: Could not find the function public.goal_finance_apply(p_command, p_quote, p_request_id) in the schema cache`. Snapshot was also missing; catalog assertions found zero RPCs. These were expected missing-feature failures against real disposable PostgreSQL/PostgREST.

First implementation run: 11/12 passed; the initial request encountered asynchronous PostgREST schema reload. The test setup now waits up to five seconds for the read-only RPC to become visible after migration, checking the expected identity-less rejection. Financial mutations are never retried by this readiness check. Next run: 12/12 passed. Expanded rollback/centavo coverage then passed 14/14 in the same focused command.

Final full DB command: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/ledger.test.mjs tests/database/reservations.test.mjs`

Exit 0; 24 tests, 24 passed, 0 failed/skipped/cancelled. These are all database test files currently present; output is passing test results and totals only.

`npx tsc --noEmit`: exit 0, no diagnostics. `git diff --cached --check`: exit 0. Git's Windows LF/CRLF notices are unrelated to test/compiler output. No build was run, per controller instruction.

## Covered behavior

Fourteen reservation tests assert unchanged PHP 30,000 actual cash after reserving 5,000; exact `30000.00`/`5000.00`/`25000.00` snapshot; zero transactions; releasing 2,000; moving 1,000 without changing total reserved; unchanged goals/balances; owned reads; rejected foreign/missing IDs; credit/non-PHP/inactive wallets; closed/archived/unreviewed goals; invalid destinations; insufficient funds; exact canonical money; unsupported command/quote rejection; anonymous permissions; pinned search paths; competing 20,000 reserves; matching/conflicting and concurrent duplicate requests; legacy separation; and per-wallet `0.01`/`99.99` accuracy.

A disposable trigger rejects the second reallocation event after the first insert. Snapshot, operation rows, and event rows remain unchanged, proving late-failure rollback. The trigger/function are removed in `finally`. All writes used local disposable fixture PostgreSQL 16/PostgREST on loopback, without reading live environment files or printing credentials.

## Files and ancillary changes

- `supabase/migrations/202610060003_goal_reservation_operations.sql`: new RPC migration.
- `tests/database/reservations.test.mjs`: real tests, migration application, and schema readiness check.
- `src/types/database.ts`: two RPC type entries.
- `.gitignore`: narrow tracking exception next to existing migration exceptions.
- `supabase/schema.sql`: appends the same migration to the reproducible ordered schema bundle; updated factual header.
- `.superpowers/sdd/2026-10-06-goal-reservations/task-3-report.md`: this report.

## Self-review and limits

Reviewed own SQL/tests/diffs, owner predicates, grants, deterministic locks, exact money validation, replay, and rollback. Corrected EOF whitespace; no outstanding findings. Antislop during session override: comment hygiene PASS, with only the factual schema header changed; UI/copy/mobile gates do not apply to this backend task.

Existing UI/direct writers and grants remain for the later planned cutover. Other commands/quote/lifecycle/adoption behavior explicitly fail pending subsequent tasks. No Task 4+ implementation, build, push, merge, deployment, or live DB migration. Controller-owned plan/progress edits remain untouched and excluded from the commit.
