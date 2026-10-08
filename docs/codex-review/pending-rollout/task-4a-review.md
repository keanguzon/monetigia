# Task 4a review: opening-debt schedule validation

Spec verdict: pass. Quality verdict: pass. The calendar lower-bound finding is addressed; no blocking findings remain in the scoped implementation.

## Addressed finding

**[P2] Reject year zero before constructing a schedule: addressed.** The original parser checked month and day but accepted `0000-01-01`; the anchor only rejected years above 9999. This allowed `buildDebtSchedule("1.00", "0000-01-01", 1)` to return a year-zero row. The current shared parser at `src/lib/transactions/installment-dates.ts:22` now rejects `year < 1 || year > 9999`, closing the gap without introducing a separate calendar implementation. New helper assertions reject year zero, accept `0001-01-01` and a single row at `9999-12-31`, and reject upper overflow. A new debt-schedule assertion covers the year-zero rejection and first supported year through the public schedule API. The scoped fix introduces no new breakage identified by inspection.

## Reviewed behavior

- `parseRemainingMonths` uses the exact digit regex, checks safe integers in 1..600, preserves `02 => 2`, and rejects spaces, signs, exponents, decimal input, overflow and out-of-range counts. The numeric schema does not coerce raw strings.
- Money remains canonical decimal text validated by the existing safe-centavo schema. The splitter retains BigInt division and remainder, uses safe integer centavos for formatting, and gives the whole remainder to the final opening row. Positive totals smaller than the row count reject, guaranteeing at least one centavo per row. Maximum safe totals remain exact.
- Opening schedules compose the existing splitter and date helper with explicit maximum 600; ordinals start at 1 and row 1 retains the entered due date, including an overdue date. The existing calendar algorithm keeps the original day, clamps February including leap years, restores March 31, and throws on upper overflow without returning a partial schedule.
- Purchase defaults remain maximum 12 with the original first-row remainder distribution. Both helpers validate explicit maxima as safe positive integers no greater than 600 before allocation; actual counts must fit the selected maximum.
- Imports remain acyclic: debt contracts import the goals Money type only; summary and date helpers import the debt ceiling; debt schedule composes those helpers. No additional arithmetic or calendar algorithm was introduced.
- The scoped package changes only the requested helpers, minimal debt contracts/schedule and their tests. It contains no SQL, UI, controller or database-type changes. The report explicitly defers SQL count, remainder, monetary-range and date parity to Task 4b and makes no backend-readiness claim.

## Evidence and limits

Reviewed the brief, worker report, complete scoped review package and current helper/contract source. The initial worker evidence was RED as 43 passed / 2 failed plus the missing-module debt suite and GREEN as 51 tests. For the calendar fix, reviewed the actual parser, helper test diff, debt schedule assertions and updated worker report: follow-up RED was 11 passed / 2 failed because both callers accepted year zero; final GREEN was 53 focused tests, compatibility consumers 44 tests, typecheck exit 0 and a clean whitespace check. Those commands were not repeated during either review. This verdict combines direct source review with the worker's reported verification; no independent runtime execution is claimed. Task 4b database parity remains a dependency before frontend exposure.
