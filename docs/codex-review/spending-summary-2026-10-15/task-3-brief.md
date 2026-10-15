### Task 3: `spending_limits` table

**Files**
- Create: `supabase/migrations/202610140002_spending_limits.sql`
- Modify: [types/database.ts](file:///c:/Users/PC/Documents/monetigia/src/types/database.ts) (add the table's Row/Insert/Update types next to `budgets`). Do **not** modify `supabase/schema.sql` (audit M03).
- Create: `tests/database/spending-limits.test.mjs`

**Schema decisions**
- Columns: `user_id uuid primary key` referencing `users(id)` with on-delete cascade, `amount numeric(15,2) not null`, check `amount > 0` and `amount <= 9999999999999.99`, `cadence text not null` with check `cadence in ('month','cutoff')`, `created_at`, `updated_at`.
- One row per user. "No limit" means **no row**: Remove deletes it.
- RLS enabled, with owner-only select/insert/update/delete policies on `auth.uid() = user_id`. Grants to `authenticated` only.
- The unused legacy `budgets` table is **not** touched or reused. It's per-category with weekly/monthly/yearly periods, which is a different model, and the Categories page delete copy still mentions it.

**DB tests**
- [ ] `owner can create, update and delete their own limit`
- [ ] `other users cannot read or write someone else's limit`
- [ ] `rejects zero, negative and unknown cadence`
- [ ] Run the suite. Expected: pass.
- [ ] Commit: `feat(spending): add optional per-user spending limit`

---



## Controller context
Current workspace C:/Users/PC/Documents/monetigia, beta-1.1 fallback. Preserve unrelated untracked audit/export files and other tasks. Plan's approved browser-local/All time choices bind later consumers. Task3 is a small isolated table/RLS/types unit, not UI or generic budgets refactor.
Fresh test harness: node .superpowers/sdd/2026-10-15-spending-summary-and-limit/run-db.mjs tests/database/spending-limits.test.mjs. Loopback PG56739 spending_fixture, REST56740 only. Escalate fixture commands if sandbox blocks access. No production mutation. Test repeated installation and raw LF/CRLF semantics for THIS migration; avoid dynamic exact-body patching. Positive finite money and owner-only grants. Explicit updated_at on UPDATE (SQL trigger or well-defined write contract); use schema maximum and test scale behavior without claiming PostgreSQL numeric preserves a rejected overprecision literal if it rounds by design.
Allowlist only the new migration in .gitignore. Add database Row/Insert/Update type + table registration following existing style. No new packages. Targeted tests and typecheck, not full suite. Commit scoped changes if permitted and write task-3-report.md. No nested agents.
