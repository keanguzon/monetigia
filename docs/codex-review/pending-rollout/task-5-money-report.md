# Task 5 money-contract extraction

## Scope

Moved the shared money type and three existing Zod schemas from `src/lib/goals/contracts.ts` to `src/lib/money/contracts.ts` before any goals-to-debt schema import. `goals/contracts.ts` imports and re-exports the same names, preserving its existing consumer API. `debt/contracts.ts` now imports the `Money` type from the leaf module.

The regular expression, safe-centavo predicate, refinements, messages, and ranges are unchanged. The new leaf module imports only Zod; the debt contract no longer depends on the goals contract.

## Regression coverage

Extended the existing money contract assertions in `tests/goal-summary.test.ts`. They cover `MoneySchema` accepting `0.00`, `PositiveMoneySchema` rejecting zero, `SignedMoneySchema` rejecting `-0.00`, canonical two-decimal formatting, and acceptance/rejection at the existing safe-centavo boundary.

Before extraction, after adding those characterization assertions:

- `npx vitest run tests/goal-summary.test.ts tests/goal-finance-client.test.ts tests/transaction-release.test.tsx tests/debt-schedule.test.ts tests/debt-creation-contracts.test.ts` — 5 files passed, 98 tests passed.
- `npx tsc --noEmit` — exit code 0.

After extraction, the same commands produced the same results: 5 files and 98 tests passed; TypeScript exited 0.

No settlement SQL, database, dependency, or production-data changes are included in this unit.
