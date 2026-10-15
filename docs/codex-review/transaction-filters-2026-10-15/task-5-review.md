## Spec Compliance

❌ Needs fixes: native-currency formatting drops recorded fractional amounts for zero-decimal currencies (`src/lib/transactions/history-format.ts:28`). The remaining Task 5 integration requirements inspected in the diff are satisfied.

## Strengths

- `src/app/(dashboard)/transactions/page.tsx:101`: the controller owns list order, pagination, query receipts and owner identity; the page does not re-sort filtered results.
- `src/app/(dashboard)/transactions/page.tsx:249`: write refresh preserves the query and retains the owned detail/group proof reads; owner checks reject superseded correction refreshes.
- `src/components/transactions/InstallmentHistoryGroup.tsx:87`: bulk matching transaction IDs map to eligible debt IDs while manual selection retains the complete eligible scope; refresh reconciles surviving selections.
- `tests/transaction-history-page.test.tsx:725`: integration coverage exercises all six authoritative sort modes across load-more; subsequent tests cover exclusive dates, clear preserving sort, owner mismatch, old-history search and post-edit membership.

## Issues

### Important

- **P2 — Preserve cents for every native currency.** `src/lib/transactions/history-format.ts:28-29`: the formatter obtains a currency-dependent parts template without fixing fractional precision. For JPY/KRW, Intl emits no decimal or fraction part, so the replacement silently discards the canonical fraction: recorded `12.50` renders `¥12` / `₩12`. This violates exact recorded-money display outside PHP amount operations. Set `minimumFractionDigits: 2` and `maximumFractionDigits: 2` on the template formatter (the accepted input contract is two decimal places), and cover a zero-decimal currency plus a large exact amount.

## Assessment

**Task quality: Needs fixes.** One concrete native-currency accuracy issue; no additional blocking finding in the scoped integration.

Checks: Reviewed the supplied b485e7e..12d99ab diff, rereading truncated output in bounded chunks. No Git reads, source edits, suite reruns or nested agents. Focused Intl reproduction confirmed PHP 12.50 → ₱12.50, USD → $12.50, JPY → ¥12, KRW → ₩12. Adjacent named-risk checks: `useTransactionDelete` owner-scoped controller/current-user guards for receipt leakage; `useTransactionHistory` loading-state expression for refresh accidentally unmounting selected groups (refresh is distinct from initial loading). Native-currency availability search found no currency allowlist in the inspected library/account components. Browser/theme/width QA and full-suite evidence remain the controller's Task 6 responsibility.
