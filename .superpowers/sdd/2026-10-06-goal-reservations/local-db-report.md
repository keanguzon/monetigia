# Disposable local database harness

Status: native PostgreSQL and PostgREST are running and verified. Keep them running until the final finance tests finish. No cloud project was created; no normal `.env` file was read or used for a write. Infrastructure files are under ignored `.superpowers/local-db`; no product files, tracked tests, migrations, package manifest, or commits were changed by this support task.

## Runtime and primary sources

- PostgreSQL 16.15, EDB Windows x64 portable archive. PostgreSQL's official Windows download page links to EDB archives: https://www.postgresql.org/download/windows/ . Archive catalog: https://www.enterprisedb.com/download-postgresql-binaries . Catalog file ID `1260623` redirected to https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip . Downloaded size: 373254386 bytes. Local SHA256: `43BB45F173A6F08CF1D29A97A6D8DEB119E8E8093A24C00D2D1001A0CCAA8281`.
- PostgREST 16.4, official project release: https://github.com/PostgREST/postgrest/releases/tag/v16.4 . Windows archive: https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-windows-x86-64.zip . Downloaded size: 15073226 bytes. Local SHA256: `29A5B56E5A09B7168BB552EF14AA7ADE40BF0A81DD0687CFFA86610187B89D78`.
- Hashes above identify the downloaded local files; they are not a claim of an independently verified publisher checksum.
- Role/JWT behavior follows the official PostgREST documentation: https://docs.postgrest.org/en/v14/references/auth.html . Cluster initialization follows https://www.postgresql.org/docs/16/app-initdb.html .
- Only `pgsql/bin`, `pgsql/lib`, and `pgsql/share` were extracted. Isolated temporary `pg` Node package lives in `.superpowers/local-db/node_modules`; the app has no new runtime dependency.

| Service | Loopback address | Purpose |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55439` | Native database `monetigia_test`; local admin user `postgres` |
| Supabase-compatible proxy | `http://127.0.0.1:55440` | Supabase SDK base URL; `/rest/v1/*` and fixture `/auth/v1/user` |
| PostgREST | `http://127.0.0.1:55441` | Actual authenticated PostgreSQL HTTP execution |

All listeners were checked as `127.0.0.1`; no listener binds a wildcard address. PostgreSQL uses trust authentication restricted by its loopback listener and generated local-only HBA entries. Admin access is intentionally for the disposable local process; do not reuse this cluster/configuration for a deployment.

## Files and bootstrap

Absolute infrastructure directory: `C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/.superpowers/local-db`.

- `bootstrap.sql`: `anon`, `authenticated` (ordinary roles), `service_role` (`BYPASSRLS`), and `authenticator` (`LOGIN NOINHERIT`, allowed to switch roles). Includes Supabase-compatible public default grants, `auth.uid()`, and `auth.role()` reading transaction-local JWT claims.
- `auth.users`: `id uuid`, `email text`, `raw_user_meta_data jsonb`, `email_confirmed_at timestamptz`. These match the existing app registration trigger's referenced fields. If the app migration installs that trigger, inserting a fixture user can create its profile automatically; current tests upsert profiles safely through their own helper.
- `connection.mjs`: fixed local native admin adapter and signed fixtures. It never obtains a database address from the normal app environment.
- `private-config.json` and `postgrest.conf`: local signing secret. Do not print or commit their contents.
- `environment.json`: ignored test variables/tokens, generated without printing secrets.
- `start.ps1`, `stop.ps1`, `proxy.mjs`, `run-test.mjs`, `write-environment.mjs`, `smoke.mjs`: reversible local lifecycle/test tools.

PostgREST requires the portable PostgreSQL `bin` directory in its process `PATH` for `libpq.dll` and dependent DLLs. `start.ps1` sets this only for the launched processes. Background processes use `Start-Process -WindowStyle Hidden`. PostgreSQL startup waits only for `pg_ctl` itself, avoiding PowerShell's descendant-process wait that would otherwise wait for the server indefinitely.

## Adapter API

Import `.superpowers/local-db/connection.mjs`:

```js
await queryAdmin(sql, params = []); // native pg result: { rows, rowCount, ... }
await createUser(email);           // { id, accessToken }; inserts auth.users
await deleteUser(id);              // deletes auth.users and cascading fixtures
await closeAdmin();                // closes the adapter pool when desired
await fixtureAuthUser(id);         // Supabase-compatible fixture user object/null
signTestJwt(claims);               // fixture signing only
verifyTestJwt(token);              // validates authenticated fixture JWT
```

Exports also include `restBaseUrl`, `anonKey`, `serviceRoleKey`, and `environment`. `environment` contains `TEST_DATABASE_DISPOSABLE=true`, `TEST_DATABASE_ADAPTER`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY`. Tokens are not included in this report.

## Exact commands

Run from `C:/Users/PC/.codex/worktrees/goal-reservations/monetigia`:

```powershell
& .superpowers/local-db/start.ps1
node .superpowers/local-db/run-test.mjs tests/database/ledger.test.mjs
node .superpowers/local-db/smoke.mjs
```

To run all existing database files using the local wrapper, expand paths in PowerShell:

```powershell
$financeTests = @(Get-ChildItem tests/database/*.test.mjs | ForEach-Object FullName)
node .superpowers/local-db/run-test.mjs @financeTests
```

The wrapper applies the ignored local test environment before spawning Node. It does not load the app `.env`.

For applying a requested migration using direct native SQL:

```powershell
& .superpowers/local-db/pgsql/bin/psql.exe -h 127.0.0.1 -p 55439 -U postgres -d monetigia_test -v ON_ERROR_STOP=1 -f supabase/migrations/202610060001_runtime_baseline.sql
& .superpowers/local-db/pgsql/bin/psql.exe -h 127.0.0.1 -p 55439 -U postgres -d monetigia_test -c "NOTIFY pgrst, 'reload schema'"
```

The adapter also supports `queryAdmin(await readFile(migrationPath, 'utf8'))`, followed by `queryAdmin("NOTIFY pgrst, 'reload schema'")`. Allow PostgREST to process the notification before a newly introduced HTTP RPC/table is requested; the smoke harness polls readiness rather than relying on a long fixed delay.

Only the runtime baseline was applied by this infrastructure task, at task1's request. The ledger migration and subsequent implementation migrations belong to their implementer. The baseline application exited 0 and committed.

When final verification is finished, stop the local processes explicitly:

```powershell
& .superpowers/local-db/stop.ps1
```

The runtime remains running at this report's completion.

## Fresh verification evidence

1. `node .superpowers/local-db/run-test.mjs tests/database/ledger.test.mjs` against baseline-only exited 1, with 9 tests, 0 passes, 9 failures. This was a genuine feature RED: `PGRST205` for missing `public.financial_operations`, missing lifecycle values, and missing ledger migration file. Fixture setup HTTP requests succeeded. The earlier premature unavailable-REST run was not counted as feature evidence.
2. `node .superpowers/local-db/smoke.mjs` after auth endpoint support exited 0 and printed exactly:

```json
{"PostgreSQL":"16.15","HTTPRoles":["anon","authenticated","service_role"],"ownerUid":"verified","crossUserRLS":"verified","nativeRowLockWait":"verified","serializedWriteValue":2,"SupabaseGetUser":"verified","forgedJWT":"rejected"}
```

The smoke test verifies ordinary authenticated roles are neither superusers nor RLS bypass roles; service role bypass is real. An actual HTTP RPC runs as each JWT role and returns the correct `auth.uid()`. Separate native PostgreSQL connections switch to `authenticated` and contend for the same row: the second writer is observed with `pg_stat_activity.wait_event_type='Lock'`, remains pending while the first transaction owns the lock, then writes the serialized value after commit. Another owner's claims produce zero visible rows under RLS. Temporary probe table/schema/RPC and user are removed in `finally`.
3. Listener inspection after closing a stalled startup shell showed `127.0.0.1` listening on `55439`, `55440`, and `55441`; servers remained running. `git status --short -- .superpowers/local-db .superpowers/sdd/2026-10-06-goal-reservations/local-db-report.md` produced no tracked changes.

## UI fixture support and limits

The proxy implements `GET /auth/v1/user` with HS256 signature, expiration, role, and subject checks, then looks up the local `auth.users` row. The existing Supabase SDK's `auth.getUser(accessToken)` was verified against this endpoint. A modified signature is rejected with HTTP 401.

For local UI verification, use the proxy URL and anon key in the preview process's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` environment, and create a local user with `createUser(email)`. A Supabase client session can be seeded with that access token and a placeholder local refresh token; fixture access tokens last 30 days. Session/cookie seeding should be confined to the local preview. Do not use the normal app's cloud environment or cookies for fixture writes.

This is an auth fixture endpoint, not GoTrue. Password sign-in, sign-up, OAuth, token refresh, account recovery, MFA, storage, and realtime APIs are unsupported. The ordinary login form cannot authenticate a fixture password against this harness; seed a local fixture session for UI verification. Financial RPC authorization, roles, RLS, transactions, and locking execute on native PostgreSQL/PostgREST.
