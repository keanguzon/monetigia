### Spec Compliance

- ❌ Issues found: canonical sorting metadata is not fully validated (`src/lib/transactions/history-filtered.ts:62`).
- ✅ The adjacent adapter preserves the existing detail/proof loaders and retains server entry order (`src/lib/transactions/history-filtered.ts:57`); controller reads retain the captured query and token (`src/hooks/use-transaction-history.ts:61`).

### Strengths

- Owner/query generations hide obsolete rows immediately, refresh supersedes outstanding reads, and stale refreshes reject (`src/hooks/use-transaction-history.ts:29`, `src/hooks/use-transaction-history.ts:56`, `src/hooks/use-transaction-history.ts:83`).
- Loaded pages are assembled before a single replacement publication, preserving earlier rows on refresh failure (`src/hooks/use-transaction-history.ts:67`, `src/hooks/use-transaction-history.ts:78`, `src/hooks/use-transaction-history.ts:82`).
- Option requests pin both owner predicates and Authorization; response validation rejects another owner's private categories (`src/lib/transactions/history-filtered.ts:109`, `src/lib/transactions/history-filtered.ts:120`).

### Issues

#### Important (Should Fix)

- `src/lib/transactions/history-filtered.ts:62`: Validate the canonical metadata, rather than membership alone. A group with children created on January 1 and January 2 currently accepts the January 1 child's `createdAt`/`sortId`; the RPC contract requires the maximum creation time and greatest ID among children at that time. `transactionDate` also accepts any syntactically valid civil date, including a single transaction's unrelated date. These malformed envelopes pass the advertised strict adapter and can present incorrect dates. Check the maximum creation pair and non-null canonical transaction-date consistency against hydrated rows, retaining null for deliberately unavailable legacy dates. Add focused malformed-envelope cases for an older creation pair, a wrong equal-time tie ID, and an unrelated valid transaction date.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** Request ownership, debounce invalidation, atomic refresh publication, and option privacy are sound in the reviewed diff. Exact metadata verification remains an explicit unmet adapter requirement.

**Checks:** Reviewed the complete authoritative Task 3 diff and reported test evidence; no tests rerun. Named adjacent-context checks: inspected `use-spending-owner.ts` for capture/current lifecycle compatibility, `history.ts` for unknown-date/group/proof adaptation, and the Task 2 history RPC migration for the canonical metadata contract. No changed source files reread and no Git operations performed.
