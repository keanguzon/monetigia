# Task 4a brief: Opening-debt schedule validation

**Executor:** Luna max. **Reviewer:** Sol medium. **Scope:** Only the pure schedule/validation portion of detailed-plan Task 1, before Task 4b schema work. User authorized implementation; draft prepared with Sol medium/high. No UI, SQL, database writes, financial-controller changes, installs, subagents or commits in this task.

Read [rollout Task 4](../../superpowers/plans/2026-10-08-pending-rollout.md), [detailed-plan Task 1 and Interfaces](../../superpowers/plans/2026-10-07-existing-debt-selection.md), [approved design](../../superpowers/specs/2026-10-07-existing-debt-selection-design.md), and current AGENTS.md. Preserve unrelated working changes. Read explicitly invoked antislop core/code skills for touched comments; comment hygiene alone does not authorize executable edits. User authorization supplies implementation scope. No comment banners or narration; preserve real compatibility constraints.

## Real source mismatches and bounded resolution

1. `src/lib/goals/contracts.ts` currently exports `MAX_INSTALLMENTS = 12`; `TransactionDraftSchema`, existing date helper and purchase splitter use it, matching the current backend. Do not change that constant or transaction schema here. Opening-debt validation gets the planned 600 safety ceiling, including 2 and 24. Task 4b must establish SQL parity before dependent UI exposes this capability. The broader plan's instruction to change every cap together is deferred to that coordinated task.
2. `splitInstallments` currently assigns remainder centavos to the earliest rows, explicitly covered by `tests/goal-summary.test.ts`. Opening debt requires every earlier row to have the equal base amount and all remainder in the final row. Extend this existing splitter through explicit options while preserving the default purchase result. Do not create a second money splitter or modify existing purchase test expectations.
3. `getInstallmentScheduleDates` already implements original-day anchoring and month-end clamping, but defaults to the purchase 12 cap. Extend it with an explicit maximum argument for the new schedule builder. Do not copy the calendar algorithm or use chained Date.setMonth/UTC conversions.
4. `Money` is a canonical decimal string and shared money schemas limit centavos to safe integers. Reuse those schemas/utilities exactly; do not expand monetary range, accept floating amounts or weaken overflow guards. Later SQL must match that accepted range or explicitly tighten the boundary contract.

## Exact files and APIs

Create `src/lib/debt/contracts.ts` with this planned draft type and minimal schedule validation exports only. Do not scaffold debt snapshots/corrections/RPC contracts from later tasks:

```ts
import type { Money } from '@/lib/goals/contracts';
export const MAX_REMAINING_MONTHS = 600;
export type OpeningDebtDraft = {
  clientId: string; name: string; mode: 'single'|'installments';
  amount: Money; firstDueDate: string; count: number;
};
export const RemainingMonthsSchema: z.ZodType<number>;
```

`RemainingMonthsSchema` uses `z.number().int().positive().safe().max(MAX_REMAINING_MONTHS)`; this numeric boundary validates parsed values, never coerces raw typed text. Single-mode draft count is 1. Item/name/owner validation and a complete OpeningDebtDraft schema belong to Task 4b, which has their backend contract.

Create `src/lib/debt/schedule.ts` with the exact APIs already specified in the detailed plan:

```ts
export function parseRemainingMonths(value: string): number|null;
export function buildDebtSchedule(
  amount: Money, firstDueDate: string, count: number
): Array<{ ordinal: number; dueDate: string; amount: Money }>;
```

- `parseRemainingMonths` accepts only `/^[0-9]+$/`, then a safe integer within 1..600. No trim, coercion of signs/exponents, partial parseInt acceptance or rounding. `'02'` is valid and produces 2; empty/space-only/padded-space text is invalid. Return null for invalid values, do not throw.
- `buildDebtSchedule` validates canonical money through existing `MoneySchema`, validates numeric count through `RemainingMonthsSchema`, and produces count rows with one-based ordinals. First due date is row 1, not one month later. Imported debt has no purchase date input; allow overdue valid dates. Reject invalid date, unsupported calendar overflow, unsafe/negative/zero money and totals smaller than count centavos. Throw an error on invalid schedule inputs rather than returning a partial schedule.
- Call the existing splitter with final-remainder mode and explicit max 600, then existing date helper with explicit max 600; zip outputs. Reuse existing `Money` type. Do not manufacture past paid rows or transaction objects.

Modify `src/lib/goals/summary.ts` backward compatibly:

```ts
export function splitInstallments(
  amount: Money, count: number,
  options?: { maxCount?: number; remainderPlacement?: 'first'|'last' }
): Money[];
```

Defaults remain `{ maxCount: MAX_INSTALLMENTS, remainderPlacement: 'first' }`. Validate explicit max as a safe positive integer no greater than 600 before allocating; retain amount/count guards. Keep the existing BigInt division/remainder calculation. For `last`, only final row receives the complete remainder; for `first`, retain current distribution. The actual count must not exceed the selected maximum. Current two-argument callers and outputs remain identical.

Modify `src/lib/transactions/installment-dates.ts` backward compatibly:

```ts
export function getInstallmentScheduleDates(
  firstDueDate: string, count: number, maxCount: number = MAX_INSTALLMENTS
): string[];
```

Validate explicit max as a safe positive integer no greater than 600, then count against it. Reuse existing parser/anchor/formatter. Existing two-argument callers still reject 13 and retain all date behavior. Share the 600 constant from the new debt contracts rather than repeat a magic ceiling; check import dependencies remain acyclic (debt contracts imports goals types only, not summary/date helpers).

Create `tests/debt-schedule.test.ts`; extend `tests/installment-dates.test.ts` and `tests/goal-summary.test.ts` only for backward-compatibility and explicit options. Do not modify `src/lib/goals/contracts.ts`, UI, migrations or database type files.

## Exact RED assertions

Add test names/assertions implementing these cases:

- `strict remaining count accepts 2, 24 and 600`: `'1'=>1`, `'2'=>2`, `'02'=>2`, `'24'=>24`, `'600'=>600`; schema accepts numeric 2/24/600. Invalid strings `'', ' ', ' 2', '2 ', '2.5', '2e1', '-2', '+2', 'abc', '2!', '0', '601', '9007199254740992'` return null; numeric schema rejects 0, -2, 2.5, NaN, Infinity, 601 and unsafe integers.
- `single debt keeps its entered due date`: `buildDebtSchedule('1000.00','2026-10-01',1)` equals `[{ordinal:1,dueDate:'2026-10-01',amount:'1000.00'}]`, even if that date is in the past.
- `final row absorbs all centavo remainder`: PHP 1,000 over 3 returns `'333.33','333.33','333.34'`; `'0.05'` over 3 returns `'0.01','0.01','0.03'`, distinguishing final-only from front-distributed remainder.
- `24 and 600 row totals remain exact`: `'1000.00'` over 24 has first 23 rows `'41.66'` and final `'41.82'`; exact centavo sum 100000. `'6.00'` over 600 yields 600 rows of `'0.01'`, first ordinal 1, last 600. Sum with shared `toMinorUnits`, never sum decimal floats.
- `dates preserve the original monthly day`: first due `2026-01-31` over 3 gives Jan31/Feb28/Mar31; leap year 2028 gives Jan31/Feb29/Mar31. A 24-row Jan31 schedule returns Mar31 after February and ends Dec31 the following year.
- `invalid schedule is rejected before rows escape`: counts 0/-1/1.5/601/Infinity; total `'0.02'` for 3 rows; `'0.00'`; negative/noncanonical `'1'`/`'1.001'`; unsafe `'90071992547409.92'`; impossible `'2026-02-30'`; date range overflow from `'9999-12-31'` with 2 rows. Maximum safe `'90071992547409.91'` over 3 has exact safe-centavo sum and final-only remainder without rounding.
- `purchase defaults remain compatible`: existing `splitInstallments('100.00',3)` stays `['33.34','33.33','33.33']`; normal max remains 12; normal 13 count throws. Explicit `{maxCount:600,remainderPlacement:'last'}` accepts 24 and has approved final remainder. Explicit invalid max 0/601/Infinity throws. Default date helper still rejects 13; explicit third argument 600 accepts 24 and clamps identically.

## Execution sequence

- [ ] Write the named tests before implementation. Run `npx vitest run tests/debt-schedule.test.ts tests/installment-dates.test.ts tests/goal-summary.test.ts`; expect failures for missing schedule exports/options, with unrelated existing assertions still passing. Record actual RED output.
- [ ] Implement minimal debt type/count boundary and backward-compatible splitter/date-helper options; compose `buildDebtSchedule` from those helpers. Do not duplicate arithmetic or calendar algorithms.
- [ ] Run that focused command again; expect all assertions passing. Run `npx tsc --noEmit`; expect exit 0. Run `npx vitest run tests/goal-finance-client.test.ts tests/transaction-release.test.tsx` to verify current purchase/request consumers remain compatible; expect no changed behavior.
- [ ] Sol medium reviews exact centavos, allocation limits, default compatibility, calendar anchoring and dependency direction. Resolve findings within scope. Report changed files, RED/GREEN evidence and the Task 4b SQL-cap/remainder/range dependency to root. No commit, push or backend readiness claim.

## Deferred requirements

Purchase date <= first due date validation is a real broader-plan requirement; opening-debt schedule APIs have no purchase date and must not invent one. Current purchase boundary parity and SQL validation are coordinated in Task 4b, before frontend capability exposure. This brief does not promise a database accepting 24/600 rows or final-remainder opening debts until that work exists. Existing opening-debt total reconciliation, payment allocation, selection, adoption and description edits remain later tasks.
