# Task 6b.1 implementation handoff

Scope frozen for independent review: shared fields and validation/preview only. No modal/standalone consumer, hooks, contracts, SQL, dependency, asset, commit or push changes.

Changed files:
- `src/components/accounts/ExistingDebtFields.tsx`
- `tests/existing-debt.test.tsx`
- This report.

The exported controlled API matches the task brief. None returns an empty array and exact zero while retaining the editing draft in the controlled value. Enabling an empty draft creates one UUID; edits/removal preserve other IDs. Consumers own ordinary-open reset and unresolved-attempt restoration.

Each item uses `OpeningDebtDraftSchema` and raw `parseRemainingMonths`. Count is a text input with numeric input mode; changes preserve pasted/typed text unchanged. Single debt sends count 1 irrespective of its retained installment text. `parseMoney` canonicalizes valid decimal amounts; item storage bounds come from the reviewed schema. Aggregate centavos use BigInt, check the account maximum before conversion through `fromMinorUnits`, and never return partial drafts on errors. Names are validated at 60 Unicode characters. Dates are required, accept overdue dates and reject invalid calendars/range overflow.

Preview appears only for a completely valid item and uses `buildDebtSchedule`. It shows the exact item total/count and first three rows. Full schedules render inline on request in a bounded scroll container, with no additional modal. Overall total appears only when all items validate. Add is disabled with a readable reason at 100 items or 6000 due rows. Every interactive control has a 44px minimum height or sits inside a 44px radio label; all controls and preview actions freeze under disabled. Field errors associate via stable IDs and `aria-describedby`/`aria-invalid`.

Verification:
- Initial import-only RED established missing module; the subsequent API scaffold run collected all 26 tests and failed all 26 for missing validation/UI behavior (exit 1, 21:40:16 local).
- GREEN focused run: 26/26 passed (exit 0, 21:41:49).
- `npx tsc --noEmit`: exit 0, no diagnostics.
- `npm test`: exit 0; 7/7 Node checks plus 27/27 Vitest files, 341/341 tests (21:42:15). No test failures reported.
- Additional coverage for visible cap reasons and withholding incomplete previews: final focused run 28/28 passed (exit 0, 21:42:58). These two checks were added after the full run; production code was unchanged.

Tests cover None zero, required name/amount/date, single count1, raw 2/02/24/600, invalid raw counts including spaces/exponents/decimals/signs, exact remainder/month-end rows, exact 19000 total, amount/item/row limits, duplicate IDs, centavo/calendar/name errors, stable generated IDs/removal, disabled controls, associated errors and on-demand 600-row rendering. Real components/helpers are used without mocks.

Design: preserved existing form controls/theme tokens and approved green/Manrope/Bricolage direction, ENERGY1/RHYTHM2/MOTION1. Spacing and fieldset legends distinguish independent debts; the exact total and schedule supply hierarchy. No decoration or new assets. Antislop during was already resolved in the parent session. Source-level delivery checks are complete; rendered browser/contrast/zoom/keyboard checks remain pending with root integration, so this report makes no visual PASS claim.

Independent review is pending. Root owns rendered checks at 320/375/768/1280, light/dark, 24/600 previews, overflow/focus/zoom/reduced motion and subsequent consumers. Physical iOS keyboard/safe-area acceptance and installed production SQL/runtime checks remain outside this shared-field unit.
