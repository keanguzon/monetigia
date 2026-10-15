### Spec Compliance

- ✅ APPROVE. The normalized version-1 wire contract, six sorts, UI date union, limits, canonical money, civil dates, UUID normalization and fingerprints match the scoped requirements (`src/lib/transactions/history-query.ts:3`, `:17`, `:44`, `:49`, `:60`, `:81`, `:109`).
- ✅ Legacy mappings are explicit (`src/lib/transactions/history-query.ts:112`); leaving existing consumers and `history.ts` unchanged follows the controller's compatibility ruling.

### Strengths

- Exact string money and BigInt comparison avoid floating-point rounding (`src/lib/transactions/history-query.ts:49`, `:97`).
- Parsing rejects unknown fields and invalid supplied values before returning an applied query (`src/lib/transactions/history-query.ts:81`).
- Tests cover literal punctuation, equivalent fingerprints, inclusive dates, limits and legacy mappings (`tests/transaction-history-query.test.ts:15`, `:21`, `:36`, `:46`, `:51`).

### Issues

- No actionable findings.

### Assessment

**Task quality:** Approved.

**Reasoning:** The isolated contract is coherent and preserves existing consumers. Accepted the reported 58 focused passing tests and successful typecheck; no tests were repeated and no external code inspection was needed.
