05dbd19 fix: allow the configured loopback API in development CSP
 .../local-preview-csp-report.md                    | 15 ++++++
 next.config.js                                     | 17 ++++++-
 package.json                                       |  2 +-
 tests/local-preview-csp.test.cjs                   | 56 ++++++++++++++++++++++
 4 files changed, 88 insertions(+), 2 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md
new file mode 100644
index 0000000..281bea9
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/local-preview-csp-report.md
@@ -0,0 +1,15 @@
+# Local preview CSP fix
+
+Date: 2026-10-07. Separate root-authorized scope after Task 10 finite-money fix commit `e5683bf`.
+
+Root supplied the user's browser console evidence that Monetigia's `connect-src` header blocked the configured `http://127.0.0.1:55440` disposable API. Existing API connectivity and JWT checks had already succeeded outside the browser. This fixes the application's development header, not browser policy or authentication code.
+
+`next.config.js` now appends only the configured normalized HTTP(S) loopback origin to `connect-src` when `NODE_ENV` is exactly `development`. Accepted hostnames are `localhost`, `127.0.0.1` and `[::1]`; URL canonicalization may normalize equivalent IPv4 spelling to `127.0.0.1`. Unsupported protocols, other hosts, credentials, malformed URLs and raw control/whitespace characters fail closed. Only `URL.origin` enters the header; path, query and fragment never do. Production and other modes preserve the complete prior header bytes. All other CSP directives, including `upgrade-insecure-requests`, and other security headers are unchanged.
+
+TDD RED: `node --test tests/local-preview-csp.test.cjs` exited 1, 2 passed / 2 failed. Development lacked the configured loopback source; preservation/rejection cases already passed.
+
+GREEN: the same command exited 0, 4/4 passed. Cases cover exact port/origin scope, HTTPS localhost, bracketed IPv6, canonical IPv4 and default ports, production/test/unset mode exclusion, nonloopback/lookalike hosts, credentials, malformed URL/protocol/port input, raw header injection and encoded path/query/fragment directives. The actual exported config's `headers()` executes in an isolated process-environment VM; tests do not read or print application environment credentials.
+
+Normal test wiring uses explicit filenames in `package.json` for Windows portability. `npm test` exited 0 with Node 6/6 and Vitest 9 files / 130 tests. `npx tsc --noEmit` exited 0. Owned `git diff --check` exited 0; no runtime test warnings. No dependency or lockfile changes.
+
+Files: `next.config.js`, `tests/local-preview-csp.test.cjs`, `package.json`, this report. No financial implementation or Task 10 review files are included in this commit. No server/process restart, database changes, live services, push, merge or deployment. Root owns preview reload/restart coordination, actual served-header verification and the user's browser retry; automated header assertions are not represented as rendered-browser evidence.
diff --git a/next.config.js b/next.config.js
index d1f72e2..835c1e4 100644
--- a/next.config.js
+++ b/next.config.js
@@ -1,23 +1,38 @@
+function developmentSupabaseOrigin() {
+  if (process.env.NODE_ENV !== "development") return null;
+  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
+  if (typeof configuredUrl !== "string" || /[\u0000-\u0020\u007f]/.test(configuredUrl)) return null;
+  try {
+    const url = new URL(configuredUrl);
+    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
+    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
+    return url.origin;
+  } catch {
+    return null;
+  }
+}
+
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
+    const localApiOrigin = developmentSupabaseOrigin();
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
@@ -29,21 +44,21 @@ const nextConfig = {
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
-              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
+              `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localApiOrigin ? ` ${localApiOrigin}` : ""}`,
               // Frames: Supabase auth uses an iframe for session refresh
               "frame-src 'self' https://*.supabase.co",
               "object-src 'none'",
               "base-uri 'self'",
               "form-action 'self'",
               "upgrade-insecure-requests",
             ].join("; "),
           },
         ],
       },
diff --git a/package.json b/package.json
index 156fe82..965db8c 100644
--- a/package.json
+++ b/package.json
@@ -1,16 +1,16 @@
 {
   "name": "monetigia",
   "version": "1.0.0",
   "private": true,
   "scripts": {
-    "test": "node --test tests/navigation-goals.test.cjs && vitest run",
+    "test": "node --test tests/navigation-goals.test.cjs tests/local-preview-csp.test.cjs && vitest run",
     "test:db": "node --test --test-concurrency=1 tests/database/*.test.mjs",
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
     "lint": "next lint",
     "db:generate": "prisma generate",
     "db:push": "prisma db push",
     "db:studio": "prisma studio"
   },
   "dependencies": {
diff --git a/tests/local-preview-csp.test.cjs b/tests/local-preview-csp.test.cjs
new file mode 100644
index 0000000..caabd44
--- /dev/null
+++ b/tests/local-preview-csp.test.cjs
@@ -0,0 +1,56 @@
+const { test } = require('node:test');
+const assert = require('node:assert/strict');
+const { readFileSync } = require('node:fs');
+const { runInNewContext } = require('node:vm');
+
+const source = readFileSync(require.resolve('../next.config.js'), 'utf8');
+const baselinePolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com https://lh3.googleusercontent.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";
+const baselineConnect = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";
+async function headers(mode, url) {
+  const loaded = { exports: {} };
+  runInNewContext(source, { module: loaded, URL, process: { env: { NODE_ENV: mode, NEXT_PUBLIC_SUPABASE_URL: url } } });
+  return JSON.parse(JSON.stringify(await loaded.exports.headers()));
+}
+const policy = result => result[0].headers.find(header => header.key === 'Content-Security-Policy').value;
+
+test('development allows only the configured normalized HTTP(S) loopback API origin', async () => {
+  for (const [url, origin] of [
+    ['http://127.0.0.1:55440/rest/v1?x=test', 'http://127.0.0.1:55440'],
+    ['https://LOCALHOST:55440/auth/v1', 'https://localhost:55440'],
+    ['http://[::1]:55440/rest/v1', 'http://[::1]:55440'],
+    ['http://127.1:55440', 'http://127.0.0.1:55440'],
+    ['http://localhost:80/', 'http://localhost'],
+  ]) {
+    const actual = policy(await headers('development', url));
+    assert.equal(actual, baselinePolicy.replace(baselineConnect, `${baselineConnect} ${origin}`));
+  }
+});
+
+test('production and nondevelopment headers remain byte-equivalent even with a loopback API configured', async () => {
+  const baseline = await headers('production', undefined);
+  assert.equal(policy(baseline), baselinePolicy);
+  for (const mode of ['production','test',undefined]) for (const url of ['http://127.0.0.1:55440','http://[::1]:55440','https://localhost:443','https://project.supabase.co']) {
+    assert.deepEqual(await headers(mode, url), baseline);
+  }
+});
+
+test('development rejects nonloopback, unsupported protocols, credentials, malformed URLs and control-character injection', async () => {
+  const baseline = await headers('production', undefined);
+  for (const url of [
+    undefined, '', 'invalid', '/api', 'https://project.supabase.co', 'http://localhost.evil.test:55440',
+    'http://127.0.0.1.evil.test:55440', 'http://127.0.0.2:55440', 'http://192.168.1.2:55440',
+    'ftp://localhost:55440', 'ws://127.0.0.1:55440', 'file:///localhost',
+    'http://user:password@localhost:55440', 'http://user@127.0.0.1:55440',
+    'http://127.0.0.1:invalid', 'http://[::1', 'http://localhost:55440\r\nconnect-src *',
+    'http://local\thost:55440', 'http://localhost:55440/\u0000',
+  ]) assert.deepEqual(await headers('development', url), baseline, String(url));
+});
+
+test('a configured loopback URL cannot add path, query, fragment or encoded header directives to CSP', async () => {
+  const baseline = await headers('production', undefined);
+  for (const url of ['http://localhost:55440/;script-src%20*?x=connect-src%20*#frame-src%20*', 'http://localhost:55440/%0d%0aContent-Security-Policy%3A%20default-src%20*']) {
+    const actual = await headers('development', url);
+    assert.equal(policy(actual), baselinePolicy.replace(baselineConnect, `${baselineConnect} http://localhost:55440`));
+    assert.deepEqual(actual[0].headers.filter(header => header.key !== 'Content-Security-Policy'), baseline[0].headers.filter(header => header.key !== 'Content-Security-Policy'));
+  }
+});
