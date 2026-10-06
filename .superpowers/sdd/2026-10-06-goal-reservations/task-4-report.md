# Task 4 implementation report

Status: DONE. Scope stops at Task 4; no UI wiring, lifecycle/deletion commands, authorization cutover, push, or live migration.

## Implementation

- Added migration 004 with strict transaction normalization, authoritative read-only quotes, and an atomic transaction dispatcher. The existing Task 3 reservation implementation is renamed once to a private `goal_reservation_apply` helper, rather than copied. Reapplying ordered migrations retains the helper and restores the public dispatcher.
- Decimal-string money, real dates, UUID normalization, unique reservation moves, and installments capped at the shared MAX_INSTALLMENTS value of 12 are validated before writes. The normalized command plus normalized confirmed releases forms request identity. Completed matching requests replay before freshness checks; changed commands/releases conflict.
- Quotes include normalized draft, authoritative account rows, allocation history, owned goal ordering/lifecycle metadata, and relevant debt transactions in the fingerprint. Default release selection uses non-priority goals first, then creation time and UUID. Custom releases must total exactly the shortfall, come from the paying wallet, and respect amounts already carried by a transfer.
- The ordinary 28,000 expense against 30,000 actual/5,000 reserved releases exactly 3,000 only after an explicit quote is supplied. It leaves actual/reserved at 2,000, available at zero, spent at zero, and one real expense. Quotes and unconfirmed saves create no rows.
- Goal expenses consume their own reservation and increment spending once. Income never allocates goal funds. Cash transfers move reservation backing using paired events and one real transfer; they preserve progress.
- Profile-first locks serialize operations with the Task 3 reservation lane. All owned goals, affected accounts, and the referenced category are locked before authoritative revalidation. Failed inserts and stale quotes roll back the operation, events, transactions, and balances.
- Ported the actual modal's credit signs and month debt carry-forward rules: purchases/outgoing credit transfers raise debt, income/payments lower it; month and total debt both limit payments. Credit installments spread remainder centavos over the first installments, create first-of-month scheduled expenses, and update debt once by the total. Credit purchases cannot carry goal tags. Cash payments to credit tagged to a debt goal consume backing and record spending once.
- Public RPCs retain auth.uid checks and pinned search paths; private helpers deny execution to PUBLIC, anon, authenticated, and service_role. SQL objects are schema-qualified.

## TDD and verification evidence

Initial RED, before any production implementation:

`node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs`

Output: tests 8, pass 0, fail 8. Required examples failed because PostgREST could not find `goal_transaction_quote` (PGRST202). No production quote function existed. This was the expected missing-feature failure.

Second RED for canonical request identity, before its fix, same command:

Output: tests 12, pass 11, fail 1. `equivalent normalized requests replay across release ordering and UUID casing` failed with `P0001: REQUEST_CONFLICT`. Normalizing confirmed release UUIDs/order fixed it.

GREEN, same focused command:

Output: tests 12, pass 12, fail 0, skipped 0. Covers exact confirmed shortfall, read-only quotes/no confirmation, ordinary income and goal expense, carrying reservation backing, multiple goals/default priority selection/custom exact release/wrong wallet/excess/insufficient actual, stale allocation and ordering changes, foreign category/account ownership, forced insert rollback of every stored row/balance, simultaneous expense/reserve, centavo remainder/debt once/debt goal spending once, equivalent replay and request conflict, expired authentication/private grants, boundary values/unsupported later commands, and credit signs/month carry-forward.

Full database suite: ran `npm run test:db` through Node spawn with an `environmentProcess` created from the ignored disposable `.superpowers/local-db/environment.json`; no configuration or token values were printed.

Output: tests 36, pass 36, fail 0, skipped 0, duration approximately 9.4 seconds. Includes all existing ledger and reservation tests.

`npx tsc --noEmit`: exit 0, no diagnostics.

Ordered schema bundle validation: created a disposable alternate schema, rewrote only explicit public schema references as the existing upgrade test does, applied the full ordered bundle twice, asserted the quote/dispatcher/private reservation functions existed, then dropped the schema. Output: `Ordered schema bundle: fresh rename and repeat application passed.` This exercises the previously absent-helper rename path and repeat application, not just a database that already had the helper.

`git diff --check`: exit 0, no whitespace errors (Git emitted line-ending notices for Windows working copies).

An early GREEN iteration hit asynchronous PostgREST schema reload on its first test; a bounded readiness poll resolved the harness race. A development edit caused a SQL syntax failure; it was fixed before the clean GREEN run. Neither failure remains.

## Files

- `supabase/migrations/202610060004_goal_transaction_operations.sql` (266 lines).
- `tests/database/financial-transactions.test.mjs` (12 real integration tests).
- `src/types/database.ts`: quote RPC signature.
- `supabase/schema.sql`: ordered migration bundle through 004, required for reproducible provisioning.
- `.gitignore`: narrow exception for migration 004 so the requested migration is tracked.
- This report.

## Self-review and concerns

No known failing checks. The single migration retains all required functionality in the planned file; the controller approved the private-helper dispatcher pattern. Fingerprinting all owned goal metadata intentionally invalidates quotes conservatively when another owned goal changes, avoiding missed ordering/lifecycle changes at the cost of potentially requesting another quote.

Existing Task 3 reservation tests reapply migration 003 in their setup and leave the disposable public dispatcher at that migration when the full suite ends. Reapply the ordered bundle or migration 004 before manual Task 4 RPC checks; deployed ordered migrations end at 004. This is a test setup artifact, not a production migration dependency.

Antislop delivery gate: PASS for this backend-only change; no UI, generated marketing claims, visual assets, or code-comment boilerplate were introduced. New SQL comments explain the private lane, request identity, and stale release validation.

The controller will conduct independent review and the final application/lint/build checkpoint. No build was requested from this implementer.

## Acceptance coverage follow-up

Strengthened the simultaneous reserve/expense integration test to assert both winner-dependent persisted outcomes. The expense winner must leave actual/reserved/available at 2,000.00/0.00/2,000.00 with one linked operation and one stored expense matching the returned transaction ID; the reserve winner must leave 30,000.00/5,000.00/25,000.00 with one linked reserve event at +5,000.00 and no transaction. Each losing request is checked for absent operation/event rows, and the losing transaction path must return `STALE_QUOTE` while the losing reserve path returns `INSUFFICIENT_AVAILABLE`.

Focused verification command: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs`

Output: tests 12, pass 12, fail 0, cancelled 0, skipped 0, todo 0; duration 3213.1998 ms. The simultaneous reserve/expense test passed (168.1963 ms).
