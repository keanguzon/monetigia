# Unit 7.1 implementation

Implemented stable-ID debt selection and a reusable correction confirmation with the existing owner-scoped debt hooks. The dialog freezes selected row IDs, account fingerprint, source, count, and exact remaining total; it requires renewed review after snapshot changes and preserves unknown attempts for same-request recovery.

The UI tests exercise `useDebt` and `useDebtCommand` through a mocked Supabase RPC transport, including an unmount/remount recovery that verifies the original request UUID and payload are retried after the snapshot no longer contains the rows.

## Changed files

- `src/lib/debt/selection.ts`
- `src/components/transactions/InstallmentSelection.tsx`
- `src/components/transactions/DebtCorrectionDialog.tsx`
- `tests/debt-selection.test.tsx`
- `tests/debt-correction-ui.test.tsx`

## Verification

- `npx vitest run tests/debt-selection.test.tsx tests/debt-correction-ui.test.tsx tests/debt-hooks.test.tsx` — exit 0; 3 files and 36 tests passed.
- Follow-up `npx vitest run tests/debt-correction-ui.test.tsx` after the remount recovery fix — exit 0; 13 tests passed (the UI suite now has one additional regression test).
- `npx tsc --noEmit` — exit 0 after the follow-up fix.

Browser and physical-device acceptance remain outside this unit's verification.
