# Task 4a report: opening-debt schedule validation

Implemented the pure schedule and validation portion of Task 4a. The schedule reuses the existing exact-centavo splitter and anchored calendar helper. Purchase callers keep their 12-installment limit and first-row remainder default; opening schedules opt into the 600-month ceiling and put all remainder in the final row.

## Changes

- Added `src/lib/debt/contracts.ts` with `MAX_REMAINING_MONTHS`, the planned `OpeningDebtDraft` type, and numeric `RemainingMonthsSchema`.
- Added `src/lib/debt/schedule.ts` with strict digit parsing and schedule construction. It validates canonical positive money and 1–600 counts, preserves an overdue first due date, and rejects impossible calendar dates, overflow, and totals too small to give every row a centavo.
- Extended `splitInstallments` with optional maximum and remainder-placement settings while retaining its existing two-argument behavior.
- Extended `getInstallmentScheduleDates` with an optional maximum while retaining the purchase default and original-day clamping. The shared parser now rejects year `0000` and accepts the supported `0001–9999` range.
- Added schedule tests and backward-compatibility tests for the existing helpers.

## Verification

- RED: `npx vitest run tests/debt-schedule.test.ts tests/installment-dates.test.ts tests/goal-summary.test.ts` exited 1. The new debt suite could not resolve its not-yet-created contracts module; the explicit 24-count splitter and date-helper assertions each failed at the existing 12-count guard. The pre-existing assertions in those two loaded suites passed (43 passed, 2 failed).
- Review follow-up RED: `npx vitest run tests/debt-schedule.test.ts tests/installment-dates.test.ts` exited 1 because both callers accepted year `0000` (11 passed, 2 failed).
- Final GREEN: `npx vitest run tests/debt-schedule.test.ts tests/installment-dates.test.ts tests/goal-summary.test.ts` passed: 3 files, 53 tests.
- `npx tsc --noEmit` exited 0.
- `npx vitest run tests/goal-finance-client.test.ts tests/transaction-release.test.tsx` passed: 2 files, 44 tests.
- `git diff --check` reported no whitespace errors.

## Task 4b dependency

This work does not change `MAX_INSTALLMENTS` or `TransactionDraftSchema`, and it does not add SQL or expose a UI path. Task 4b must align database validation with the opening schedule's 1–600 count, final-row remainder, canonical safe-centavo range, and supported date behavior before frontend capability is exposed. No persistence or backend-readiness claim is made here.
