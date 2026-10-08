# Task 4b: atomic opening-debt creation

Implemented on `codex/mobile-pwa-follow-ups`, starting from reviewed Task 4a `ef9282a`. Ready for root's financial review; no commit, push or production migration execution performed.

## Delivered files

- `supabase/migrations/202610080002_existing_debt_creation.sql`: additive, reapplicable schema, owner-select RLS, authenticated-only creation RPC, exact numeric schedules, shared operation registry and debt-history deletion guard. This file is ignored by repository Git rules and must be explicitly added during integration.
- `src/lib/debt/contracts.ts`: strict opening draft, account creation input/result schemas and types. Existing Task 4a exports and shared Money remain intact.
- `src/types/database.ts`: debt item/due-row tables and creation RPC signature.
- `tests/debt-creation-contracts.test.ts`, `tests/database/existing-debt.test.mjs`: creation contract and disposable database acceptance.
- `tests/database/helpers.mjs`, `tests/database/installment-final-state.test.mjs`: install all current migrations in filename order so old financial guard reapplication cannot leave newer RPC grants revoked.

No other worker's draft briefs or rollout plan were edited by this executor.

## Contract and storage

`debt_account_create(uuid,jsonb,jsonb)` returns only `{accountId,debtItemIds,replayed}`. Item IDs retain request order. Owner is `auth.uid()`; the owner's profile row is locked before registry lookup or financial writes. Normalized names are trimmed consistently with JavaScript; complete ordered command JSON and SHA256 must both match on replay. Incomplete/missing saved results fail closed. Identical concurrent calls create once; reuse by a different command conflicts; another owner can use the same request UUID independently.

The transaction creates one active PHP credit account, opening obligations and due rows, and one completed operation. Balance is assigned once from exact principal. No cash, goal, expense, purchase or payment records are invented. Empty debt input creates a zero balance credit wallet.

New creation limits are **100 items, 6000 aggregate rows, 1..600 months per item, PHP 9,999,999,999,999.99 per item and total**. Single mode requires one row. Amounts are canonical positive decimal text with two decimals; storage uses unconstrained numeric plus scale/range checks. Every row receives at least one centavo; the final row receives all remainder. Due dates preserve the original anchor day, accept overdue dates, and stay within years 0001..9999. No purchase-date input exists.

New tables have owner-composite foreign keys, authenticated SELECT only and no client write policies. Creation uses a pinned SECURITY DEFINER search path and grants execution only to authenticated, excluding PUBLIC, anon and service_role. Helper execution is revoked. Existing account guards retain allocation/transaction history protection and auth-user cascade cleanup, and also protect debt history.

## Verification evidence, October 8, 2026

All database commands used the existing disposable local harness at localhost port 55440. No production `.env` database configuration, resets, project deletion, or persistent preview/QA record cleanup was used. Fixture cleanup deleted only newly generated test users. A fixture-specific late-failure trigger was removed in `finally`.

| Command | Exit | Evidence |
| --- | --- | --- |
| `npx vitest run tests/debt-creation-contracts.test.ts` before implementation | 1 | RED: 6/6 failed for absent schema exports |
| `node 'C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db/run-test.mjs' --test-concurrency=1 tests/database/existing-debt.test.mjs` before implementation | 1 | RED: 5/5 failed for missing debt tables/RPC |
| `npx vitest run tests/debt-creation-contracts.test.ts tests/debt-schedule.test.ts tests/installment-dates.test.ts tests/goal-summary.test.ts tests/goal-finance-client.test.ts tests/transaction-release.test.tsx` | 0 | GREEN: 103/103, 6 files |
| `npx tsc --noEmit` | 0 | Final typecheck passed; an earlier ES5 string iteration error was resolved with `Array.from` |
| Local harness with `--test-concurrency=1 tests/database/migration-security.test.mjs tests/database/ledger.test.mjs tests/database/financial-transactions.test.mjs tests/database/archived-goals.test.mjs tests/database/installment-dates.test.mjs tests/database/installment-final-state.test.mjs` | 0 | GREEN: 53/53 |
| Local harness with `--test-concurrency=1 tests/database/existing-debt.test.mjs`, after older suites and final changes | 0 | GREEN: 10/10; full chronological installation and final grants asserted |
| `git diff --check` | 0 | No whitespace errors; Git emitted existing LF/CRLF conversion notices |

Database assertions cover 16,000 + 3,000 = 19,000 balance, unchanged fixture cash/goals/history, zero-debt creation, ordered IDs, repeated migration preservation, replay after normalizing names, four concurrent identical requests, changed name/amount/order conflicts, other-owner request independence and existing-command collision. Every invalid payload retains the prior account/items/rows/registry state. A failure on due row 3 proves rollback after persistent inserts have begun and subsequent use of the same request succeeds.

Schedule assertions include 1000/3 = 333.33/333.33/333.34, 0.05/3 = 0.01/0.01/0.03, 24 and 600 exact totals, the full 100-item/6000-row boundary, Jan31 → Feb28/29 → Mar31, year 0001, entered overdue dates, and maximum account/date boundary. Invalid JSON types, counts, scale, dates, overflow, duplicate IDs and account controls reject atomically.

Security assertions cover cross-owner empty reads, denied direct INSERT/UPDATE/DELETE, privileged mismatched-owner FK inserts, unconstrained numeric typmods, money checks, debt-account deletion rejection, normal empty-history account deletion, missing profile rejection and generated auth-user cleanup. Final schema assertions verify RLS, owner SELECT policies, absence of table/column writes, pinned definer search path, PUBLIC/anon/service-role execute denial, helper denial and restored archived-goal grants.

Final installed purchase assertions retain the 12-month cap: 13/24/600 reject, and 1000/3 remains 333.34/333.33/333.33. No dispatcher or purchase splitter defaults were changed.

## Boundaries and handoff

This deliverable supplies opening-debt creation and owner-scoped table reads. A complete `debt_snapshot` is deferred to Task 6, after purchase mapping and audited settlement/correction exist. Payment allocation, reversals, corrections, legacy adoption, frontend recovery integration and Add Wallet UI are later tasks. No partial snapshot RPC or fabricated reconciliation is exposed.

Later UI must explain the narrower account money range and honor 100-item/6000-row allocation limits. Root must review locks/replay/grants/FKs and explicitly add the ignored migration before committing. Reviewed SQL must be applied and runtime-verified before dependent frontend release. Production readiness, full application build/lint, browser/device acceptance and independent financial review are not claimed by this scoped report.
