# Local preview setup

The ignored local Next preview is running at `http://127.0.0.1:3107` and listens on IPv4 loopback only. The app redirects an authenticated request to `http://localhost:3107/dashboard`, so use `http://localhost:3107` in the browser. The local Supabase proxy is `http://127.0.0.1:55440`; its database/PostgREST services remain at `127.0.0.1:55439` and `127.0.0.1:55441`.

## Reusable setup

- Ensure the ignored local database harness is running with `& .superpowers/local-db/start.ps1` before creating or refreshing a fixture session.
- Start or check the owned preview and cookie bootstrap: `& .superpowers/local-db/preview-start.ps1` (the preview launcher starts the helper on `127.0.0.1:3108`).
- Browser bootstrap URL: `http://localhost:3108/__local_preview_session`; it sets the private auth cookie and remember-me cookie, then redirects to `http://localhost:3107/dashboard`. Its response has no body, the JWT never appears in the URL, and the cookie remains readable to Supabase SSR/client code. Only the fixed path and localhost hosts are accepted. The helper has separate owned-PID lifecycle scripts under the ignored harness.
- Stop the preview and bootstrap: `& .superpowers/local-db/preview-stop.ps1`
- Create or refresh its auth fixture session: `node .superpowers/local-db/prepare-preview-session.mjs`
- Private session metadata is stored in ignored `.superpowers/local-db/preview-session.json`. Cookie name is `sb-127-auth-token`; the file also has the cookie value and the remember-me middleware cookie. Do not print or commit it.
- The preview start script reads only the ignored local fixture module's URL and anon key for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. It overrides `SUPABASE_SERVICE_ROLE_KEY` with a disabled local marker. The application source references no other Supabase environment variables.
- PID cleanup requires the saved PID to still match the absolute Node executable, repository Next CLI path, `dev -p 3107`, and `-H 127.0.0.1`; startup refuses an unrelated listener on port 3107. The process starts hidden.

## Browser fixture metadata

Run `node .superpowers/local-db/prepare-preview-fixtures.mjs` to seed the existing preview user through the fixed local admin adapter. It uses stable IDs and `ON CONFLICT DO NOTHING`, so reruns do not duplicate or reset records. The complete ignored manifest, including all record IDs and initial amounts, is `.superpowers/local-db/preview-fixtures.json`.

- Wallets: GCash (PHP 30,000.00 opening balance), Cash (PHP 10,000.00), Credit Card Debt (PHP 5,000.00; excluded from net worth), and GoTyme Savings (PHP 20,000.00, `type=bank`, `is_savings=true`).
- Goals: Phone (5,000.00), Laptop (30,000.00), Date (3,000.00), and Debt Goal (5,000.00). Each has `status=active`, `review_state=confirmed`, and `current_amount=0.00` explicitly seeded.
- The user's nine existing expense and income categories are included with IDs in the manifest for transaction-form metadata.
- The owner profile existed before seeding. Owner-scoped counts after reruns were 4 wallets, 4 goals, 9 categories, 0 transactions, 0 financial operations, and 0 allocation events.
- GoTyme was checked against Task 3's existing eligibility condition: reject `credit_card`, non-`PHP`, or inactive wallets. Its `bank` type, `PHP` currency, and active status satisfy the condition; `is_savings=true` is retained as wallet metadata.
- The seeder writes only `accounts` and `goals`; it does not call financial commands, create transaction/allocation/operation rows, or run acceptance flows.

## Fixture and limits

One local auth user was created for browser UI setup: `local-preview+20261006235731@example.invalid` (ID `e0e0f57c-a738-4d47-a231-c75928d1055d`). Its wallets, goals, and categories are the metadata fixtures listed above. No finance acceptance flow was run. The proxy validates the session through `/auth/v1/user`; it does not provide GoTrue password login, refresh, registration, recovery, OAuth, MFA, storage, or realtime.

## Checks completed

- Confirmed all preview setup and lifecycle scripts are ignored by Git.
- Started Next on port 3107 and confirmed the listener is `127.0.0.1` only.
- Re-ran start and confirmed it recognizes the owned process without starting another.
- A read-only auth request returned the same fixture user (HTTP 200); a request to the Next preview with the private cookie reached the authenticated dashboard redirect (HTTP 307).
- The bootstrap route returned HTTP 302 with only the two expected cookie names and an empty body; following its cookies against the preview produced the authenticated dashboard redirect. No UI screenshots or acceptance actions were performed.

## Follow-up after interrupted preview

- On 2026-10-07, all listeners on 55439, 55440, 55441, 3107, and 3108 were absent; saved proxy, PostgREST, preview, and bootstrap PIDs were also absent, and `pg_ctl status` reported no running server. This accounts for the current connection-refused result.
- Restarted the ignored local DB harness and preview. PostgreSQL, proxy, PostgREST, Next, and cookie bootstrap now listen on `127.0.0.1` at their expected ports. The listener processes and saved preview command were checked against the local paths/commands.
- Read only the fixture URL: `http://127.0.0.1:55440`. Requests to `http://localhost:3107/` returned 200 and unauthenticated `http://localhost:55440/auth/v1/user` returned 401. A localhost-origin OPTIONS request from `http://localhost:3107` returned 204 with that origin reflected in `Access-Control-Allow-Origin`.
- `localhost` resolves `::1` before `127.0.0.1`; the tested PowerShell requests succeeded. All owned listeners currently bind IPv4 loopback. The worktree's `node_modules` is a junction to the main workspace dependencies.
- The existing trace contained only requests with `origin:null` (SSR), so it does not establish why the earlier browser request was `ERR_BLOCKED_BY_CLIENT`. The proxy source and `.pre-debug` copy have identical hashes; the metadata-only request trace remains available for a fresh browser probe. No auth/session values were read or printed.



