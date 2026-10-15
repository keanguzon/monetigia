antislop active: during (session override).

### Spec Compliance
- ✅ Spec compliant: `src/hooks/use-data.ts:73` includes owner and all four dates in the SWR key; `src/hooks/use-data.ts:78` captures one request for both RPC calls and checks owner freshness before returning data; `src/hooks/use-data.ts:87` converts validated money through cents into all four legacy numeric fields.
- ✅ `src/app/(dashboard)/dashboard/page.tsx:230` adds a conditional exclusion note scoped to period Income and Expenses and distinguishes account balances.
- ⚠️ Shared refresh matcher compatibility is unchanged in this diff; the controller should rely on Task 4's matcher review/evidence as specified in the brief.

### Strengths
- `src/hooks/use-data.ts:96` hides data while identity is unresolved or stale and preserves identity errors without duplicating owner lifecycle machinery.
- `tests/dashboard-stats.test.tsx:141` exercises real hook wiring against RPC fixtures; the suite includes pinned tokens, range keys, same-period parity, both RPC error paths, owner changes, stale responses, and the three Dashboard ranges.

### Issues
- No Critical, Important, or Minor findings within Task 5 scope.

### Assessment
**Task quality:** Approved.
**Reasoning:** The scoped Dashboard migration preserves its display API while using owner-pinned authoritative summaries. Accepted the reported 11/11 focused tests and successful typecheck; no additional tests or external checks were needed.
