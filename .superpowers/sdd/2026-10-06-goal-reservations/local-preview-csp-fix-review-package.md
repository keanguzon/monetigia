8cb894c fix: preserve HTTP loopback API requests in development
9148353 fix: reject zero goal targets in authenticated writes
 .../local-preview-csp-report.md                    | 31 ++++++++++++++++------
 .../2026-10-06-goal-reservations/task-10-report.md | 10 +++++++
 next.config.js                                     | 10 +++----
 .../migrations/202610060006_goal_write_guards.sql  |  3 ++-
 supabase/schema.sql                                |  3 ++-
 tests/database/migration-security.test.mjs         | 31 ++++++++++++++++++++++
 tests/local-preview-csp.test.cjs                   | 21 +++++++++++++--
 7 files changed, 92 insertions(+), 17 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md
index 281bea9..6d54c7e 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md
@@ -1,15 +1,30 @@
-# Local preview CSP fix
+# Local preview CSP fix review
 
-Date: 2026-10-07. Separate root-authorized scope after Task 10 finite-money fix commit `e5683bf`.
+- Base: `e5683bf`
+- Head: `05dbd1967548522123c6f87e28f119aa78e38f8f`
 
-Root supplied the user's browser console evidence that Monetigia's `connect-src` header blocked the configured `http://127.0.0.1:55440` disposable API. Existing API connectivity and JWT checks had already succeeded outside the browser. This fixes the application's development header, not browser policy or authentication code.
+## Verdict
 
-`next.config.js` now appends only the configured normalized HTTP(S) loopback origin to `connect-src` when `NODE_ENV` is exactly `development`. Accepted hostnames are `localhost`, `127.0.0.1` and `[::1]`; URL canonicalization may normalize equivalent IPv4 spelling to `127.0.0.1`. Unsupported protocols, other hosts, credentials, malformed URLs and raw control/whitespace characters fail closed. Only `URL.origin` enters the header; path, query and fragment never do. Production and other modes preserve the complete prior header bytes. All other CSP directives, including `upgrade-insecure-requests`, and other security headers are unchanged.
+**PASS — ready for the intended development configuration fix.** The change matches the bounded requirement: it adds only a parsed HTTP(S) loopback origin from the configured URL to `connect-src`, only when `NODE_ENV` is exactly `development`. Outside that case, the prior headers are byte-equivalent. The existing CSP directives and other security headers are preserved.
 
-TDD RED: `node --test tests/local-preview-csp.test.cjs` exited 1, 2 passed / 2 failed. Development lacked the configured loopback source; preservation/rejection cases already passed.
+## Findings
 
-GREEN: the same command exited 0, 4/4 passed. Cases cover exact port/origin scope, HTTPS localhost, bracketed IPv6, canonical IPv4 and default ports, production/test/unset mode exclusion, nonloopback/lookalike hosts, credentials, malformed URL/protocol/port input, raw header injection and encoded path/query/fragment directives. The actual exported config's `headers()` executes in an isolated process-environment VM; tests do not read or print application environment credentials.
+No in-diff correctness or security findings.
 
-Normal test wiring uses explicit filenames in `package.json` for Windows portability. `npm test` exited 0 with Node 6/6 and Vitest 9 files / 130 tests. `npx tsc --noEmit` exited 0. Owned `git diff --check` exited 0; no runtime test warnings. No dependency or lockfile changes.
+## Scope and evidence
 
-Files: `next.config.js`, `tests/local-preview-csp.test.cjs`, `package.json`, this report. No financial implementation or Task 10 review files are included in this commit. No server/process restart, database changes, live services, push, merge or deployment. Root owns preview reload/restart coordination, actual served-header verification and the user's browser retry; automated header assertions are not represented as rendered-browser evidence.
+Reviewed only the packaged CSP change in `next.config.js`, its four focused Node tests, and the `package.json` test wiring. URL parsing rejects unsupported schemes, credentials, malformed/control-character input, and host lookalikes; interpolation uses `URL.origin`, so URL path/query/fragment values cannot add directives. Tests compare the complete policy for accepted cases and complete header objects for excluded cases. The package records `npm test` and TypeScript checks passing; this review did not rerun them.
+
+The package also records a served HTTP 200 response whose CSP contains `http://127.0.0.1:55440`. A rendered browser retry remains outstanding, so browser acceptance is not established by this review. The existing `upgrade-insecure-requests` directive is intentionally unchanged per scope; the browser retry is the evidence needed to close that runtime question.
+
+Concurrent Task 10 worktree changes were excluded from this review.
+
+## Follow-up: preserve HTTP loopback API requests in development
+
+A later authenticated browser trace received `OPTIONS 204` for the configured loopback API but showed no subsequent auth-user read or finance RPC. Since the served policy already allowed the exact API origin, the remaining `upgrade-insecure-requests` directive became the likely cause: it can rewrite the configured `http://` fetch to HTTPS before the request reaches the local service. This is an inference from the browser trace and current header, not a confirmed browser result.
+
+The development policy now omits that directive only when the validated configured Supabase URL uses `http:` and an allowed loopback hostname. HTTPS loopback keeps the directive; production, other modes, malformed or nonloopback URLs, and a missing API URL retain the prior policy bytes. No other CSP directive or security header changed.
+
+TDD RED: `node --test tests/local-preview-csp.test.cjs` exited 1, 3/5 passed. The two new HTTP loopback assertions failed because `upgrade-insecure-requests` was still present.
+
+GREEN: the same focused command exited 0, 5/5 passed, including byte-equivalent production/nondevelopment headers, HTTPS loopback retention, no-API behavior, and rejected origins. Full `npm test` exited 0: Node 7/7 and Vitest 9 files / 130 tests passed. No TypeScript sources changed, so no separate typecheck was required. The owned Next process was not restarted; root will apply the committed config and perform the browser retry. That retry must establish the auth-user read and account/RPC requests before claiming rendered acceptance.
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
index 4a17197..572ecad 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
@@ -52,10 +52,20 @@ Task 10 implementation and automated checks are complete. Independent review and
 ## Review fix round 1: finite authenticated money writes
 
 Independent review found PostgreSQL numeric `NaN` bypassed the opening balance's NULL/negative check. The same typed numeric domain permits `NaN` in directly editable goal target/allocation amounts. These are authenticated direct-write guards; no legacy values are automatically rewritten and privileged fixture setup remains available.
 
 - Opening balances now explicitly reject nonfinite, null, negative and out-of-range values. Goal target/allocation guards apply on creation and when each money column is explicitly updated. Separate column triggers allow unrelated metadata/target edits to leave an untouched legacy invalid allocation intact for separate review. The trigger helper has pinned search path and no direct PUBLIC/anon/authenticated/service_role execution grants.
 - Mirrored migration 006 in the reproducible schema and added the existing-invalid-money audit to deployment preflight. The typed numeric columns still determine decimal rounding; this fix makes no new promise to reject excess input scale before PostgreSQL's column conversion.
 - RED: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 1 with 9 passed / 3 failed. Ordinary authenticated HTTP opening `NaN`, goal creation `NaN` target, and goal update `NaN` target unexpectedly succeeded. Each failure explicitly asserted that the write must be denied.
 - GREEN: the same focused command exited 0, 12/12 passed. Tests cover both goal money columns on insert/update, `NaN`, positive/negative infinity, malformed numeric text, null, negative and overflow values, zero/positive/max finite openings, valid goal creation/target recomputation, unchanged actual/reserved balances, and retained untouched legacy invalid allocation after reapplication.
 - Full final verification: `npm run test:db` with ignored disposable environment only exited 0, 69/69 passed; `npm test` exited 0, Node 2/2 and Vitest 9 files / 130 tests; `npx tsc --noEmit` exited 0. No runtime test warnings. The reservations after-hook restored current migrations and the preview user's data was not reset.
 - Files: migration 006, schema.sql, migration-security tests, rollout checklist and this report. No root plan/progress/review edits, live database changes, dependencies, push, merge or deployment.
+
+## Review fix round 2: authenticated target amounts must be positive
+
+The scoped re-review of round 1 found that direct authenticated goal writes still accepted a zero target, although the application contract requires a positive target. Allocation-per-cycle remains allowed to be zero.
+
+- The goal money trigger now rejects `target_amount <= 0` while retaining the existing zero-allowed allocation rule. The migration and reproducible schema contain identical `guard_goal_money` definitions.
+- Added authenticated insert and update coverage for string and numeric zero targets, unchanged snapshots after rejection, a positive one-cent target, a zero allocation, and target edits that preserve existing reservations and recompute progress.
+- Focused verification: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 0, 14/14 passed.
+- Full native database verification: `npm run test:db` exited 0, 71/71 passed, 0 failures, 0 skipped. The command received only the ignored disposable-local database environment. The reservation suite's cleanup reapplied migrations 004–006, leaving the preview database on current migration 006.
+- No TypeScript sources changed. No live project, preview account data, plan/progress/review documents, push, merge, or deployment was changed by this fix round.
diff --git a/next.config.js b/next.config.js
index 835c1e4..94de950 100644
--- a/next.config.js
+++ b/next.config.js
@@ -1,38 +1,38 @@
-function developmentSupabaseOrigin() {
+function developmentSupabaseApi() {
   if (process.env.NODE_ENV !== "development") return null;
   const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
   if (typeof configuredUrl !== "string" || /[\u0000-\u0020\u007f]/.test(configuredUrl)) return null;
   try {
     const url = new URL(configuredUrl);
     if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
     if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
-    return url.origin;
+    return { origin: url.origin, protocol: url.protocol };
   } catch {
     return null;
   }
 }
 
 /** @type {import('next').NextConfig} */
 const nextConfig = {
   distDir: process.env.MONETIGIA_BUILD_DIR || ".next",
   async redirects() {
     return [
       {
         source: "/transactions/new",
         destination: "/transactions",
         permanent: true,
       },
     ];
   },
   async headers() {
-    const localApiOrigin = developmentSupabaseOrigin();
+    const localApi = developmentSupabaseApi();
     return [
       {
         source: "/(.*)",
         headers: [
           { key: "X-Content-Type-Options", value: "nosniff" },
           { key: "X-Frame-Options", value: "DENY" },
           { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
           { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
           {
             key: "Strict-Transport-Security",
@@ -44,27 +44,27 @@ const nextConfig = {
               "default-src 'self'",
               // Scripts: self + Next.js inline scripts + Supabase auth (uses postMessage iframes)
               "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
               // Styles: self + inline styles used by Tailwind/shadcn
               "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
               // Fonts
               "font-src 'self' https://fonts.gstatic.com",
               // Images: self + Supabase storage + OAuth avatars + data URIs
               "img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
               // API connections: self + Supabase
-              `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localApiOrigin ? ` ${localApiOrigin}` : ""}`,
+              `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localApi ? ` ${localApi.origin}` : ""}`,
               // Frames: Supabase auth uses an iframe for session refresh
               "frame-src 'self' https://*.supabase.co",
               "object-src 'none'",
               "base-uri 'self'",
               "form-action 'self'",
-              "upgrade-insecure-requests",
+              ...(localApi?.protocol === "http:" ? [] : ["upgrade-insecure-requests"]),
             ].join("; "),
           },
         ],
       },
     ];
   },
   images: {
     remotePatterns: [
       {
         protocol: "https",
diff --git a/supabase/migrations/202610060006_goal_write_guards.sql b/supabase/migrations/202610060006_goal_write_guards.sql
index 46a904b..4ac583d 100644
--- a/supabase/migrations/202610060006_goal_write_guards.sql
+++ b/supabase/migrations/202610060006_goal_write_guards.sql
@@ -59,21 +59,22 @@ BEGIN
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 DECLARE v_amount numeric;
 BEGIN
   IF current_user='authenticated' THEN
     v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
-    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000
+      OR (TG_ARGV[0]='target_amount' AND v_amount<=0) THEN
       RAISE EXCEPTION 'INVALID_STATE';
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 47d39e3..c22fec8 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -999,21 +999,22 @@ BEGIN
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 DECLARE v_amount numeric;
 BEGIN
   IF current_user='authenticated' THEN
     v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
-    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000
+      OR (TG_ARGV[0]='target_amount' AND v_amount<=0) THEN
       RAISE EXCEPTION 'INVALID_STATE';
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
diff --git a/tests/database/migration-security.test.mjs b/tests/database/migration-security.test.mjs
index f26d33f..d18651f 100644
--- a/tests/database/migration-security.test.mjs
+++ b/tests/database/migration-security.test.mjs
@@ -229,10 +229,41 @@ test('authenticated goal money edits reject nonfinite values, preserve valid der
   assert.equal(totals(f, after).progressPercent, 50);
   assert.equal(totals(f, after).reserved, '1000.00');
   assert.equal(wallet(f, after).actual, '30000.00');
   requireSuccess(await f.admin.from('goals').update({ allocation_per_cycle: 'NaN' }).eq('id', f.owner.goal.id));
   await applyMigration('202610060006_goal_write_guards.sql');
   requireSuccess(await f.owner.client.from('goals').update({ target_amount: '3000.00', name: 'Legacy reviewed separately' }).eq('id', f.owner.goal.id));
   const { queryAdmin } = await databaseRuntime();
   const old = await queryAdmin(`SELECT allocation_per_cycle::text AS allocation,target_amount::text AS target FROM public.goals WHERE id='${f.owner.goal.id}'::uuid`);
   assert.deepEqual(old, [{ allocation: 'NaN', target: '3000.00' }]);
 });
+
+test('authenticated zero-target goal creation is denied while positive targets with zero allocation remain valid', async t => {
+  const f = await setup(t), initial = await snap(f);
+  for (const target_amount of ['0.00',0]) {
+    const result = await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Zero target', target_amount, allocation_per_cycle: '0.00' });
+    assert.equal(result.error?.message, 'INVALID_STATE');
+    assert.deepEqual(await snap(f), initial);
+  }
+  const row = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Small positive target', target_amount: '0.01', allocation_per_cycle: '0.00' }).select().single());
+  const after = (await snap(f)).goals.find(g => g.goalId === row.id);
+  assert.equal(after.target_amount, '0.01');
+  assert.equal(after.allocation_per_cycle, '0.00');
+});
+
+test('authenticated zero-target updates leave the snapshot intact and zero-allocation target edits still recompute progress', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
+  const initial = await snap(f);
+  for (const target_amount of ['0.00',0]) {
+    const result = await f.owner.client.from('goals').update({ target_amount }).eq('id', f.owner.goal.id);
+    assert.equal(result.error?.message, 'INVALID_STATE');
+    assert.deepEqual(await snap(f), initial);
+  }
+  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '2000.00', allocation_per_cycle: '0.00' }).eq('id', f.owner.goal.id));
+  const after = await snap(f);
+  assert.equal(totals(f, after).target_amount, '2000.00');
+  assert.equal(totals(f, after).allocation_per_cycle, '0.00');
+  assert.equal(totals(f, after).progressPercent, 50);
+  assert.equal(totals(f, after).reserved, '1000.00');
+  assert.equal(wallet(f, after).actual, '30000.00');
+});
diff --git a/tests/local-preview-csp.test.cjs b/tests/local-preview-csp.test.cjs
index caabd44..92f3f13 100644
--- a/tests/local-preview-csp.test.cjs
+++ b/tests/local-preview-csp.test.cjs
@@ -15,24 +15,39 @@ const policy = result => result[0].headers.find(header => header.key === 'Conten
 
 test('development allows only the configured normalized HTTP(S) loopback API origin', async () => {
   for (const [url, origin] of [
     ['http://127.0.0.1:55440/rest/v1?x=test', 'http://127.0.0.1:55440'],
     ['https://LOCALHOST:55440/auth/v1', 'https://localhost:55440'],
     ['http://[::1]:55440/rest/v1', 'http://[::1]:55440'],
     ['http://127.1:55440', 'http://127.0.0.1:55440'],
     ['http://localhost:80/', 'http://localhost'],
   ]) {
     const actual = policy(await headers('development', url));
-    assert.equal(actual, baselinePolicy.replace(baselineConnect, `${baselineConnect} ${origin}`));
+    const expected = baselinePolicy.replace(baselineConnect, `${baselineConnect} ${origin}`);
+    assert.equal(actual, url.startsWith('http:') ? expected.replace('; upgrade-insecure-requests', '') : expected);
   }
 });
 
+test('only a configured HTTP loopback API suppresses upgrade-insecure-requests in development', async () => {
+  const http = policy(await headers('development', 'http://127.0.0.1:55440/auth/v1'));
+  assert.equal(http, baselinePolicy
+    .replace(baselineConnect, `${baselineConnect} http://127.0.0.1:55440`)
+    .replace('; upgrade-insecure-requests', ''));
+  assert.doesNotMatch(http, /upgrade-insecure-requests/);
+
+  const https = policy(await headers('development', 'https://localhost:55440/auth/v1'));
+  assert.equal(https, baselinePolicy.replace(baselineConnect, `${baselineConnect} https://localhost:55440`));
+  assert.match(https, /upgrade-insecure-requests/);
+
+  assert.equal(policy(await headers('development', undefined)), baselinePolicy);
+});
+
 test('production and nondevelopment headers remain byte-equivalent even with a loopback API configured', async () => {
   const baseline = await headers('production', undefined);
   assert.equal(policy(baseline), baselinePolicy);
   for (const mode of ['production','test',undefined]) for (const url of ['http://127.0.0.1:55440','http://[::1]:55440','https://localhost:443','https://project.supabase.co']) {
     assert.deepEqual(await headers(mode, url), baseline);
   }
 });
 
 test('development rejects nonloopback, unsupported protocols, credentials, malformed URLs and control-character injection', async () => {
   const baseline = await headers('production', undefined);
@@ -43,14 +58,16 @@ test('development rejects nonloopback, unsupported protocols, credentials, malfo
     'http://user:password@localhost:55440', 'http://user@127.0.0.1:55440',
     'http://127.0.0.1:invalid', 'http://[::1', 'http://localhost:55440\r\nconnect-src *',
     'http://local\thost:55440', 'http://localhost:55440/\u0000',
   ]) assert.deepEqual(await headers('development', url), baseline, String(url));
 });
 
 test('a configured loopback URL cannot add path, query, fragment or encoded header directives to CSP', async () => {
   const baseline = await headers('production', undefined);
   for (const url of ['http://localhost:55440/;script-src%20*?x=connect-src%20*#frame-src%20*', 'http://localhost:55440/%0d%0aContent-Security-Policy%3A%20default-src%20*']) {
     const actual = await headers('development', url);
-    assert.equal(policy(actual), baselinePolicy.replace(baselineConnect, `${baselineConnect} http://localhost:55440`));
+    assert.equal(policy(actual), baselinePolicy
+      .replace(baselineConnect, `${baselineConnect} http://localhost:55440`)
+      .replace('; upgrade-insecure-requests', ''));
     assert.deepEqual(actual[0].headers.filter(header => header.key !== 'Content-Security-Policy'), baseline[0].headers.filter(header => header.key !== 'Content-Security-Policy'));
   }
 });
