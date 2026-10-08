# Task 5.2b report: Atomic selected debt correction

Implemented `supabase/migrations/202610080004_debt_corrections.sql` and the focused database suite `tests/database/debt-corrections.test.mjs`. Added one final-state assertion to `tests/database/installment-final-state.test.mjs` for dispatcher routing and grants. The migration was force-added because `.gitignore` excludes `supabase/migrations/*`; it is staged without a commit.

The SQL handler accepts only the strict correction command shape, canonicalizes unique UUID selections into sorted order, and requires a lowercase 64-character fingerprint. It locks the authenticated owner before registry replay lookup, returns completed identical replays before checking freshness, and rejects conflicting or incomplete request IDs. New requests lock financial rows in the existing order, compare the full private account fingerprint, require an active balanced PHP credit account and one group of positive remaining rows, append one correction event per row, and reduce credit balance by the exact total. Purchase transactions, payment rows, cash, and settlement events remain unchanged.

The existing public dispatcher is extended with an exact-source, sentinel-guarded patch that calls a private fixed-search-path handler. Existing public RPC grants remain intact; the handler has no client execute grants. The delete branch rejects purchases referenced by settlement or correction events before it computes a cash or debt reversal. Payment deletion still uses the existing settlement reversal path.

Verification evidence:

- RED: after starting the existing disposable local database without resetting its data, the new correction cases failed through the old dispatcher with `INVALID_STATE`.
- GREEN: focused correction DB suite, 4/4 passed.
- Existing sequential DB suites for settlements, financial transactions, goal lifecycle, and final installed state, 51/51 passed.
- `npx tsc --noEmit`, exit 0.
- `git diff --check`, exit 0.

The first harness attempt hit `ECONNREFUSED` on local PostgreSQL port 55439; the provided local start script started the existing disposable instance, and the behavioral RED/GREEN runs then completed. No production SQL was executed. Independent review remains outstanding.
