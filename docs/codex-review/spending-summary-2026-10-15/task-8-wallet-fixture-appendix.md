# Task 8 wallet fixture appendix

The wallet reservation integration test’s Supabase mock still rejected all RPCs except `debt_snapshot`, so the Dashboard showed its read-error state after Task 5 switched its aggregate reads to `spending_summary`. The fixture now returns the validated summary shape for the October period and comparison range, and records/unsubscribes auth-state listeners used by the owner hook.

The existing assertions for Income (`₱2,500.00`), Expenses (`₱1,100.00`), and Total Balance (`₱30,000.00`) remain before and after releasing the reservation. They still verify that releasing a reservation does not change transaction totals.

## Verification

- Before the fixture update, the named regression reproduced at the Income assertion because Dashboard rendered its read-error alert.
- `npx vitest run tests/wallet-reservations.test.tsx`: **18/18 passed**.
- No production code or reservation assertions changed.
