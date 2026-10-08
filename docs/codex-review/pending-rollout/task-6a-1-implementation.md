# Task 6a.1 implementation evidence

Scope: SQL snapshot/adoption and public contracts only. Production source is ready for independent review; dependent 6a.2 has not started.

## Changes

- `supabase/migrations/202610080005_debt_snapshot_adoption.sql` (ignored by repository SQL rule; must be explicitly included in review/commit): complete authenticated snapshot, private adoption handler, current-dispatcher addition, private opening-item provenance and shared opening-item validator.
- `src/lib/debt/contracts.ts`: exact snapshot rows/accounts, safe canonical money and row arithmetic validation, strict adoption command using the existing creation validator.
- `src/lib/goals/contracts.ts`: adoption in the financial command union.
- `src/types/database.ts`: snapshot RPC signature.
- `tests/debt-snapshot-contracts.test.ts`, `tests/database/debt-snapshot.test.mjs`, `tests/database/debt-adoption.test.mjs`: contracts and native behavior.
- `tests/database/installment-final-state.test.mjs`: authenticated final-installed create/snapshot/adopt/correct/archived-restore behavior.

The shared SQL validator is extracted verbatim from reviewed creation validation; the migration rewires creation to the same validator. Creation's balance derivation and due-row insertion remain unchanged. Adoption uses the same final-remainder opening schedule without updating balances, cash, reservations or transactions. It acquires the owner lock before replay lookup, then the existing goal/account lock order, and checks current reconciliation/fingerprint/residual before any insert. Completed replay precedes stale checks.

The snapshot retains the owner lock across every account-state read, includes inactive owner credit accounts and uses the existing Task 5 state adapter without row limits. Only opening-item provenance is extended: completed adoption operations prove their immutable associated items through normalized command fields and account ID. FinancialResult remains unchanged with empty transactionIds.

## RED/GREEN evidence

Before implementation, `npx vitest run tests/debt-snapshot-contracts.test.ts` failed 4/4 assertions because the schemas were absent. Before migration 005, the explicitly disposable native command failed 6/6 because the public snapshot did not exist (PGRST202 / PostgreSQL 42883).

Disposable runner:

`node C:/Users/bibliyuh/Downloads/Monetigia-beta-1.1-20261008-155725/Monetigia-beta-1.1-20261008-155725/local-db/run-test.mjs --test-concurrency=1 <files>`

Results on 2026-10-08:

- Initial snapshot/adoption native GREEN: 6/6.
- Expanded snapshot/adoption native GREEN: 10/10, including 5,001 proven purchases, corrections and payment reversal, advances/refund review, inactive/USD/zero accounts.
- Broad native run of snapshot, adoption, existing creation, settlement, correction, lifecycle and final-state files: 61/61 (74.30 seconds).
- After extending adoption native boundaries and final-installed RPC assertions, adoption plus final-state files: 10/10 (20.41 seconds). Added mixed purchase preservation, 600-row final remainder, >100 items, >6000 rows, aggregate/range/date/name/count rejection.
- `npx vitest run tests/debt-snapshot-contracts.test.ts tests/debt-creation-contracts.test.ts tests/debt-correction-contracts.test.ts tests/debt-schedule.test.ts`: 22/22.
- `npx tsc --noEmit`: passed.
- Root executed full `npm test`: Node 7/7 plus Vitest 285/285 across 24 files, after separately reviewed portability fixes committed as 4572ce1.

## Rulings and limits

Refund-like income preserves Task 5's review behavior, with an authoritative unchanged balance and no invented allocation. A credit advance becomes truthful undated residual. Unsupported currencies return separate account entries marked needs_review; consumers must not add unlike currencies as PHP. Public schema deliberately carries no invented currency conversion.

A formerly undated payment reversal after adoption restores its original residual portion without changing adopted principal or fabricating row payments. Unknown dates remain null; all audit rows remain in the snapshot.

The chronological restoration helper already discovers every migration and sorts filenames, so it includes 005 automatically. Windows migration line-ending normalization was implemented and verified by root as a separate harness portability change. No production database, install, UI/client/hook edit, commit or push was performed by this implementer. Existing untracked user files were preserved. Independent review remains required before 6a.2.
