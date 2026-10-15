# Task 3 report — Spending limits

Base: `1c8f8af`
Commit: `3f98be535cdb49888c34fd8a27a3c5df963e004b`

Added the optional one-row-per-user `spending_limits` table with positive finite `numeric(15,2)` amounts, `month`/`cutoff` cadence, cascading user ownership, timestamp maintenance, owner-only CRUD RLS, and authenticated-only table grants. Added matching database types and a focused local database test. `supabase/schema.sql` and the legacy `budgets` table were not changed.

Proof:

- TDD RED: the focused runner failed on the missing `public.spending_limits` table (`PGRST205`).
- GREEN: `node .superpowers/sdd/2026-10-15-spending-summary-and-limit/run-db.mjs tests/database/spending-limits.test.mjs` — 4 passed, 0 failed.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit` — exit 0.
- The focused suite checked CRUD and `updated_at`, cross-user and anon denial, duplicate-user rejection, invalid/nonfinite/out-of-range amounts, cadence validation, exact numeric scale/range, and repeated raw LF/CRLF installation with matching catalog semantics and grants.
- Commit contains only `.gitignore`, `src/types/database.ts`, the new migration, and the focused test. Existing untracked audit/export files remain untouched.

Concern for consumers: PostgREST decodes `numeric` values to JavaScript numbers. The database preserves exact `numeric(15,2)` storage; the maximum is checked as text through direct SQL because a JavaScript number cannot represent every cent at that magnitude.
