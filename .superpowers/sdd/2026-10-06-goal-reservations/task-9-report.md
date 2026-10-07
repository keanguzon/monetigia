# Task 9 implementation report

Date: 2026-10-07
Branch: `codex/goal-reservations`

## Changes

- Wallets now shows actual, goal-reserved, and available balances from the finance snapshot while preserving the existing net-worth inclusion rules and credit-card separation. Reservation amounts use canonical decimal strings and integer cents for aggregation.
- Wallets consumes the shared SWR account data so successful finance-operation revalidation updates a mounted page. Adding a wallet refreshes both account and finance snapshot data.
- Removed fetch-time credit-card balance writes. Stored card debt remains authoritative for the card tile; the transaction-derived debt preview keeps its existing signs, month normalization, and filters. Debt read errors no longer appear as zero debt or allow a misleading preview.
- Wallet and Dashboard readers now show an error instead of fabricated zero balances. Dashboard transaction, previous-period, and account-type reader failures propagate to its error state; dashboard metrics remain based on real accounts and transactions.
- Added five focused UI/read tests. Stabilized the existing contributions test's `useAccounts` mock after verifying its fresh inline array on every render caused a maximum-update-depth loop with the new data refresh effect. Its snapshot now includes the matching active PHP wallet; existing assertions remain intact.
- Added a rollout checklist for statement-anchored credit opening-balance comparison. No live balances were read and no correction values were invented.

## Verification

- `npx vitest run tests/wallet-reservations.test.tsx` — exit 0; 1 file, 5 tests passed.
- `npx tsc --noEmit` — exit 0.
- `npm test` — exit 0; Node tests 2/2; Vitest 8 files, 116 tests passed.
- `npx vitest run tests/contributions.test.tsx` — exit 0; 1 file, 8 tests passed without maximum-update-depth warnings.
- No SQL changed, so no database test was run. No live environment or database was accessed.
- Rendered-browser verification remains with the separate Task 11 gate; the local API preview is blocked by the browser policy in this session.

## Review boundary

No migration, schema, deployment, push, or merge was performed. The debt audit is documented for an authorized pre-cutover operator; it still requires statement evidence and a read-only review against the actual deployment data.
