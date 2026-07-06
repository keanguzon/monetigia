# Monetigia — Architecture & Quality Review

**Date:** 2026-07-06
**Scope:** Full workspace — `src/**`, `supabase/**`, config files
**Methodology:** Adversarial read-only review. No files modified.

---

## 1. Architecture

### 1.1 — Giant monolithic page files

**Severity:** Medium
**Location:** [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx) (1200 lines, 54 KB)
**Evidence:** The accounts page is a single 1200-line client component that handles wallet rendering (two view modes), drag-and-drop reordering, debt calculation from transactions, credit-card balance syncing, inline editing, delete confirmation modals, and integration with two separate modals. This violates single-responsibility.
**Impact:** Any change to the accounts page risks breaking unrelated features. Reasoning about data flow within this file requires holding >50 state variables in your head. Future contributors will struggle.
**Recommendation:** Extract into focused sub-components: `DebtBreakdown`, `AccountCard`, `AccountListItem`, `AccountOrderEditor`, etc. Push debt sync logic into a dedicated hook or utility.

### 1.2 — Client-side balance management (no server-side transaction logic)

**Severity:** High
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L263-L308), [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L82-L109), [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L383-L419)
**Evidence:** Transaction creation inserts a row into `transactions`, then separately reads the current account balance, modifies it in JavaScript, and writes it back as a second `update`. Transaction deletion does the same in reverse. The accounts page *also* recalculates credit-card balances from all historical transactions and force-syncs them on every load. There is no database trigger, stored procedure, or even a server-side API route orchestrating this. All balance mutations happen from the browser.
**Impact:** This is the most architecturally fragile part of the application. See finding 3.1 for the race condition details and 5.1 for the authorization gap.
**Recommendation:** Move balance mutation to a Postgres function (`record_transaction`) that inserts the transaction and adjusts balances atomically within a single database transaction.

### 1.3 — No shared data layer / state management library

**Severity:** Low
**Location:** All dashboard pages
**Evidence:** Every page independently calls `supabase.auth.getUser()` and `supabase.from("accounts").select(...)`. Currency preference is fetched on every page load. There is no React Context, Zustand store, or SWR/React Query cache.
**Impact:** Redundant network requests on every navigation. Stale data if user has two tabs open. No optimistic updates.
**Recommendation:** Introduce a lightweight data layer (React Query or a custom context) for shared entities: user, accounts, preferences.

---

## 2. Security

### 2.1 — CSP allows `'unsafe-inline'` and `'unsafe-eval'` for scripts

**Severity:** Medium
**Location:** [next.config.js](file:///c:/Users/bibliyuh/Documents/monetigia/next.config.js#L21)
**Evidence:** `script-src 'self' 'unsafe-inline' 'unsafe-eval'` — This effectively nullifies the XSS protection that CSP is supposed to provide.
**Impact:** If an attacker finds any way to inject HTML (e.g., a stored XSS via a transaction description rendered without escaping), the CSP will not block it.
**Recommendation:** Use nonces for inline scripts (Next.js supports this). Remove `'unsafe-eval'` unless a specific dependency requires it.

### 2.2 — `ensure-profiles-bucket` route lacks CSRF and rate-limit protection

**Severity:** Medium
**Location:** [ensure-profiles-bucket/route.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/api/storage/ensure-profiles-bucket/route.ts)
**Evidence:** This POST route creates a Supabase storage bucket using the service role key. Unlike `upload-avatar`, it has no `assertSameOrigin()` call and no rate limiting. It does require authentication, but the absence of CSRF protection means any page the user visits could trigger it cross-site (via `fetch` with credentials, subject to browser SameSite cookie policy).
**Impact:** An attacker could abuse this to repeatedly attempt bucket creation calls from a third-party page. Practical impact is low (the bucket either exists or doesn't), but it's an inconsistency.
**Recommendation:** Add `assertSameOrigin()` and rate limiting, matching `upload-avatar`.

### 2.3 — In-memory rate limiter does not survive serverless cold starts or scale

**Severity:** Medium
**Location:** [rate-limit.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/lib/security/rate-limit.ts#L6)
**Evidence:** `const buckets = new Map<string, Bucket>();` — This is module-level state in a serverless environment. Each cold start or new serverless instance gets a fresh, empty map.
**Impact:** On Vercel, every new invocation may get a new instance, making the rate limiter useless against distributed attacks. An attacker just needs to send requests fast enough to hit different instances.
**Recommendation:** This is acceptable for single-instance development. For production, use Vercel KV, Upstash Redis, or Supabase's built-in rate limiting.

### 2.4 — `getClientIp` trusts the last IP in `X-Forwarded-For`

**Severity:** Low
**Location:** [rate-limit.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/lib/security/rate-limit.ts#L29-L36)
**Evidence:** The comment says "Take the LAST IP — it's added by the trusted reverse proxy." This is correct for Vercel's single-hop proxy, but if deployed behind a CDN or additional proxy, the "last" IP may not be the client's. The correctness depends on deployment topology.
**Impact:** If misconfigured, rate limiting could target the proxy's IP instead of the client, either blocking all users or blocking none.
**Recommendation:** Document that this logic assumes Vercel's single-proxy topology. If deploying elsewhere, adjust the index.

### 2.5 — Avatar file extension derived from untrusted filename

**Severity:** Low
**Location:** [settings/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/settings/page.tsx#L88)
**Evidence:** `const fileExt = file.name.split(".").pop();` — The file extension comes from the user-chosen filename. Although the server validates MIME type and the upload path is scoped to `avatars/{user.id}/`, the stored filename extension could be misleading (e.g., `avatar.html`). Supabase storage serves files with `Content-Type` based on extension in some configurations.
**Impact:** Extremely low since MIME validation is in place and the bucket serves publicly, but a `.html` extension could theoretically be served as HTML by some CDN caches.
**Recommendation:** Derive extension from the validated MIME type instead of the filename.

---

## 3. Data Flow

### 3.1 — Race condition: read-then-write balance updates without transactions or locks

**Severity:** Critical
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L264-L308)
**Evidence:** The balance update pattern is:
```
1. SELECT balance FROM accounts WHERE id = X  → gets current = 1000
2. newBal = current + amount                  → computes 1200
3. UPDATE accounts SET balance = 1200 WHERE id = X
```
If two transactions are submitted concurrently (e.g., user clicks fast, two browser tabs, or installment batch), both read `1000`, both compute their new balance independently, and the last write wins. One transaction's balance effect is silently lost.
**Impact:** Permanent, silent data corruption. Account balances will drift from the sum of their transactions over time. The accounts page has a "self-healing" mechanism that recalculates credit-card balances on load, but it only covers credit cards — not cash, bank, e-wallet, or investment accounts.
**Recommendation:** Use a Postgres function with `UPDATE accounts SET balance = balance + $1 WHERE id = $2` (atomic increment), or better, a full stored procedure wrapping the insert + balance update in a single database transaction.

### 3.2 — Transaction insert succeeds but balance update can fail silently

**Severity:** High
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L247-L309)
**Evidence:** The transaction is inserted first (line 247), then balance is updated separately (lines 264-308). If the balance update fails (network error, RLS violation, stale client), the transaction exists but the balance is wrong. The user sees "Transaction added" because the success toast fires after the insert, not after the balance update. The error path for balance updates does not roll back the transaction.
**Impact:** Phantom transactions that don't affect balances. Requires manual correction.
**Recommendation:** Wrap both operations in a Postgres function or at minimum check the balance update result and roll back (delete) the transaction if it fails.

### 3.3 — Transfer delete reversal logic duplicates creation logic but can diverge

**Severity:** Medium
**Location:** [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L92-L109)
**Evidence:** The delete handler manually reverses the balance changes. The credit-card logic is:
- Creation: `src is credit_card → src + amt`, `dst is credit_card → dst - amt`
- Deletion: `src is credit_card → src - amt`, `dst is credit_card → dst + amt`

This is mathematically correct *today*, but the two code paths are in different files with no shared abstraction. If the creation logic changes (e.g., a fee is added), the deletion logic must be updated in lockstep, and there is no test to catch drift.
**Impact:** Silent balance corruption if the two code paths diverge.
**Recommendation:** Extract balance adjustment into a single shared function.

---

## 4. State Management

### 4.1 — Stale closure over `supabase` client in `useEffect`

**Severity:** Low
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L13), [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L48)
**Evidence:** `const supabase = createClient()` is called at render time (not memoized), but `useEffect` closures with `[]` dependencies capture a stale reference. In `AddTransactionForm`, the `load` effect on line 41 closes over the initial `supabase` but has no dependency on it. The ESLint exhaustive-deps warning is likely suppressed.
**Impact:** Unlikely to cause issues in practice because `createBrowserClient` returns a singleton in `@supabase/ssr`, but the pattern is fragile.
**Recommendation:** Memoize the Supabase client with `useMemo` (as done in `AuthSessionManager`), or call it inside the effect.

### 4.2 — `as any` used pervasively to bypass type safety

**Severity:** Medium
**Location:** [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L49), [dashboard/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/dashboard/page.tsx#L28), [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L25)
**Evidence:** `const sb = supabase as any;` appears in every data-heavy page. All state arrays are typed `any[]`. The `Database` type exists and is well-defined, but it's actively bypassed.
**Impact:** TypeScript provides no protection against query errors, typos in column names, or type mismatches. The `display_order` column used in accounts is not in the `Database` type, suggesting the schema and types have diverged.
**Recommendation:** Update `database.ts` to match the actual schema (including `display_order`, `username`). Remove `as any` casts.

---

## 5. Backend

### 5.1 — Balance updates bypass RLS (no `user_id` filter on account updates)

**Severity:** High
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L277), [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L86)
**Evidence:** Balance updates use `.update({ balance: newBal }).eq("id", effectiveAccountId)` — filtering only by `id`, not by `user_id`. Although RLS policies enforce `auth.uid() = user_id` on updates, this means the code *relies entirely* on RLS for authorization. If the RLS policy were ever disabled, misconfigured, or bypassed (e.g., via the service role key), any authenticated user could update any other user's account balance by guessing a UUID.
**Impact:** Defense-in-depth violation. With RLS in place, the risk is low. Without RLS (or with a service role path), it's a direct IDOR.
**Recommendation:** Always include `.eq("user_id", user.id)` on account mutations, matching the pattern already used in `saveInterestRate` and `deleteAccount` in the accounts page (which correctly does `.eq("user_id", user.id)`).

### 5.2 — No pagination for transactions

**Severity:** Medium
**Location:** [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L146), [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L315)
**Evidence:** Transactions are loaded with `.limit(50)` (transactions page) or `.limit(5000)` (accounts page for debt calculation). There is no "load more" or pagination mechanism.
**Impact:** Users with many transactions (>50) will never see older ones on the transactions page. The 5000-limit on the accounts page means debt calculations may be incomplete for power users with extensive credit-card history.
**Recommendation:** Add cursor-based pagination on the transactions page. For debt calculation, consider a database view or aggregation function.

---

## 6. Frontend

### 6.1 — `createClient()` returns an empty object `{}` when env vars are missing

**Severity:** Medium
**Location:** [client.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/lib/supabase/client.ts#L10-L11)
**Evidence:** When Supabase env vars are missing or placeholders, the function returns `{} as SupabaseClient<Database>`. Any call like `supabase.auth.getUser()` will throw `TypeError: Cannot read properties of undefined (reading 'getUser')` at runtime.
**Impact:** Confusing, undiagnosable crashes during development setup. The error message won't mention Supabase or environment variables.
**Recommendation:** Throw a descriptive error during client creation, or return a properly-typed stub that logs warnings.

### 6.2 — Login page redirects to `/` unconditionally

**Severity:** Low
**Location:** [login/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/login/page.tsx)
**Evidence:** `redirect("/")` — The login page immediately redirects to the landing page. The landing page has the auth form embedded. This means any link or bookmark to `/login` loses query parameters (like `?redirect=/settings`).
**Impact:** The middleware redirects unauthenticated users to `/?redirect=/path`, but if a user manually navigates to `/login?redirect=/settings`, the redirect param is lost.
**Recommendation:** Either preserve query parameters in the redirect, or remove the `/login` route entirely.

### 6.3 — `useEffect` dependency on `[refreshKey]` misses `dateRange` coupling

**Severity:** Low  
**Location:** [dashboard/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/dashboard/page.tsx#L193)
**Evidence:** The `lastMonthBalance` calculation on line 193 references `currentMoney`, but `currentMoney` is derived from `accounts` state which is set inside the same effect. At the time of execution, `currentMoney` is computed from the *previous render's* `accounts` state, not the freshly fetched data.
**Impact:** The "last month balance" and percentage change may be calculated from stale data on the first render. It self-corrects on the next render cycle.
**Recommendation:** Compute `currentMoney` inside the effect from `accountsData` directly, not from React state.

---

## 7. Database

### 7.1 — `username` column exists in schema but missing from TypeScript types

**Severity:** Medium
**Location:** [schema.sql](file:///c:/Users/bibliyuh/Documents/monetigia/supabase/schema.sql#L43) vs [database.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/types/database.ts#L12-L21)
**Evidence:** The `users` table has a `username TEXT UNIQUE NOT NULL` column. The TypeScript `Database.users.Row` type does not include `username`. Similarly, `display_order` is used in the accounts page query (line 270) but doesn't exist in the TypeScript type or the SQL schema.
**Impact:** Type-safety is compromised. Queries referencing `display_order` will fail if the column hasn't been added via a migration not in the repo.
**Recommendation:** Sync the TypeScript types with the actual database schema. Add the missing migration for `display_order` if it exists.

### 7.2 — No `updated_at` trigger

**Severity:** Low
**Location:** [schema.sql](file:///c:/Users/bibliyuh/Documents/monetigia/supabase/schema.sql)
**Evidence:** Multiple tables have `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`, but there is no trigger to auto-update `updated_at` on row modification. The column will always reflect the creation time unless manually set.
**Impact:** `updated_at` is misleading — it never changes after insert.
**Recommendation:** Add a `moddatetime` trigger or a custom trigger to auto-update `updated_at` on `UPDATE`.

### 7.3 — `handle_new_user()` is `SECURITY DEFINER` with no search_path restriction

**Severity:** Medium
**Location:** [schema.sql](file:///c:/Users/bibliyuh/Documents/monetigia/supabase/schema.sql#L286)
**Evidence:** The trigger function is `SECURITY DEFINER` (runs with the function owner's privileges, typically `postgres`) but does not set `search_path`. A malicious user who can create objects in `public` could theoretically shadow built-in functions.
**Impact:** Low in Supabase's managed environment, but it's a Postgres security best practice violation.
**Recommendation:** Add `SET search_path = public, pg_temp` to the function definition.

### 7.4 — Missing composite index on `transactions(user_id, date)`

**Severity:** Low
**Location:** [schema.sql](file:///c:/Users/bibliyuh/Documents/monetigia/supabase/schema.sql#L141-L143)
**Evidence:** There are separate indexes on `user_id` and `date`, but most queries filter by `user_id` AND sort/filter by `date`. The two single-column indexes may not be combined efficiently by the planner.
**Impact:** Slightly slower transaction queries for users with many transactions.
**Recommendation:** Add a composite index: `CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC)`.

---

## 8. Performance

### 8.1 — Accounts page fetches up to 5000 transactions on every load

**Severity:** Medium
**Location:** [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L305-L315)
**Evidence:** Every time the accounts page loads, it fetches up to 5000 transactions (with joins on `categories` and `accounts`) to calculate monthly debt breakdowns, then potentially writes back corrected credit-card balances.
**Impact:** Slow page load for users with many transactions. Wasteful network transfer. On mobile (for your upcoming app), this will be especially painful.
**Recommendation:** Move debt aggregation to a database view or RPC function. The client should receive pre-computed monthly totals, not raw transactions.

### 8.2 — No loading state debounce for interest rate saves

**Severity:** Low
**Location:** [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L94-L128)
**Evidence:** `saveInterestRate` fires on `onBlur`. If a user tabs through multiple savings accounts quickly, multiple concurrent requests fire. There is no debounce or queue.
**Impact:** Minor — each request is independent and idempotent. But it could cause flickering if the responses arrive out of order.
**Recommendation:** Add a debounce or use `useTransition`.

---

## 9. Accessibility

### 9.1 — Native `<select>` and `<input type="checkbox">` used without ARIA labels

**Severity:** Medium
**Location:** [AddTransactionForm.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/forms/AddTransactionForm.tsx#L330), [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L843-L849)
**Evidence:** Several `<select>` elements have visible `<label>` tags above them but are not linked via `htmlFor`/`id`. The "Include in Net Worth" checkboxes in the tile view use `id={`networth-${account.id}`}` with matching `htmlFor`, which is correct — but the same checkboxes in the list view use `id={`networth-row-${account.id}`}`. This is fine for uniqueness but the tile/list duplication means both DOM elements exist simultaneously (AnimatePresence with `mode="wait"`), so there shouldn't be ID collisions.
**Impact:** Screen readers may not associate labels with their form controls for the `<select>` elements.
**Recommendation:** Add `id` attributes to all `<select>` elements and link them with `htmlFor` on their labels.

### 9.2 — Custom modals lack focus trap and keyboard dismissal

**Severity:** Medium
**Location:** [accounts/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/accounts/page.tsx#L1178-L1196), [transactions/page.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/(dashboard)/transactions/page.tsx#L333-L368)
**Evidence:** Delete confirmation modals are implemented as plain `<div>` overlays. They don't trap focus (Tab can reach elements behind the modal), don't have `role="dialog"` or `aria-modal="true"`, and don't close on Escape key.
**Impact:** Screen reader users and keyboard-only users cannot interact with these modals properly.
**Recommendation:** Use Radix UI's `Dialog` component (already a dependency) for these modals.

---

## 10. Testing

### 10.1 — Zero test files exist

**Severity:** High
**Location:** Entire repository
**Evidence:** There is no `__tests__` directory, no `*.test.ts` files, no `*.spec.ts` files, no test runner configuration (Jest, Vitest, Playwright), and no test scripts in `package.json`. The `planning.md` is a security audit, not a test plan.
**Impact:** Every deployment is a manual QA session. The critical balance-management logic (finding 3.1, 3.2, 3.3) has no automated verification. Regressions are discovered in production.
**Recommendation:** At minimum, add unit tests for:
- `parsePositiveAmount`, `parseNonNegativeAmount`, `sanitizeColor`, `isValidUuid`
- `sanitizeRedirect` (both client and server versions)
- `consumeRateLimit`
- Balance calculation logic (when extracted into a shared function)

---

## 11. Maintainability

### 11.1 — Prisma dependencies remain but are not used

**Severity:** Low
**Location:** [package.json](file:///c:/Users/bibliyuh/Documents/monetigia/package.json#L10-L12), [.gitignore](file:///c:/Users/bibliyuh/Documents/monetigia/.gitignore#L40-L42)
**Evidence:** `package.json` includes `@prisma/client` (dependency) and `prisma` (devDependency) with scripts `db:generate`, `db:push`, `db:studio`. The application uses Supabase's client SDK directly — there are no Prisma models or schema files.
**Impact:** Wasted `node_modules` space, confusing for contributors.
**Recommendation:** Remove Prisma dependencies and scripts.

### 11.2 — Duplicated `sanitizeRedirect` function

**Severity:** Low
**Location:** [auth/callback/route.ts](file:///c:/Users/bibliyuh/Documents/monetigia/src/app/auth/callback/route.ts#L21-L28), [LandingPage.tsx](file:///c:/Users/bibliyuh/Documents/monetigia/src/components/landing/LandingPage.tsx#L36-L41)
**Evidence:** Two independent implementations of `sanitizeRedirect` exist — one server-side, one client-side. They have slightly different comments but identical logic.
**Impact:** If one is updated without the other, redirect validation may diverge.
**Recommendation:** Extract to a shared utility in `lib/`.

### 11.3 — 14 vulnerabilities in dependencies

**Severity:** Medium
**Location:** `npm audit` output (from the recent pull)
**Evidence:** `14 vulnerabilities (4 moderate, 9 high, 1 critical)` — reported by `npm audit` during the install.
**Impact:** Depends on which packages are affected. The critical vulnerability should be investigated immediately.
**Recommendation:** Run `npm audit` and address the critical vulnerability. Use `npm audit fix` for safe fixes.

---

## 12. Overall Risk Assessment

### Must Fix Before Release

| # | Finding | Severity | Why |
|---|---------|----------|-----|
| 3.1 | Race condition in balance updates | **Critical** | Silent data corruption under concurrent use |
| 3.2 | Transaction insert can succeed while balance update fails | **High** | Inconsistent state, no rollback |
| 1.2 | Client-side balance management | **High** | Root cause of 3.1 and 3.2 — needs server-side atomicity |
| 5.1 | Balance updates missing `user_id` filter | **High** | Defense-in-depth violation (IDOR if RLS fails) |
| 10.1 | Zero automated tests | **High** | No safety net for critical financial logic |

### Can Wait Until Later

| # | Finding | Severity |
|---|---------|----------|
| 2.1 | CSP `unsafe-inline`/`unsafe-eval` | Medium |
| 2.2 | `ensure-profiles-bucket` missing CSRF | Medium |
| 2.3 | In-memory rate limiter | Medium |
| 4.2 | Pervasive `as any` bypassing TypeScript | Medium |
| 5.2 | No pagination for transactions | Medium |
| 7.1 | Schema/type drift (`username`, `display_order`) | Medium |
| 8.1 | 5000-transaction fetch on accounts page | Medium |
| 9.1 | Missing ARIA labels on selects | Medium |
| 9.2 | Custom modals lack focus trap | Medium |
| 11.3 | 14 npm vulnerabilities (1 critical) | Medium |
| 1.1 | Monolithic 1200-line page file | Medium |
| 3.3 | Duplicated balance reversal logic | Medium |
| 7.3 | `SECURITY DEFINER` without `search_path` | Medium |

### Looks Good

| Area | Notes |
|------|-------|
| **RLS policies** | Comprehensive and correctly scoped per table. SELECT/INSERT/UPDATE/DELETE all filtered by `auth.uid() = user_id`. Default categories are read-only for non-owners. |
| **Auth middleware** | Uses `getUser()` (not `getSession()`), copies cookies correctly on redirects. Route matching is consistent between middleware config and the protected-routes list. |
| **OAuth callback** | `escapeJsonForInlineScript` correctly prevents `</script>` breakout. `sanitizeRedirect` blocks open redirects. Cookies are forwarded on all response paths. |
| **Upload-avatar route** | MIME validation, size check, path traversal check, IDOR prevention (`avatars/{user.id}/`), CSRF check, rate limiting — all present and correct. |
| **Security headers** | HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy — all configured correctly. |
| **`.gitignore`** | All `.env*` patterns are covered. No risk of leaking secrets. |
| **UUID validation** | `isValidUuid()` is used consistently before interpolating IDs into Supabase filter strings. |
| **Input validation** | `parsePositiveAmount()` and `parseNonNegativeAmount()` cap at 999M and round to 2 decimal places. `sanitizeColor()` validates hex format. Description length is capped at 160 chars. |
| **Landing page** | Clean, responsive design with proper Suspense boundary for `useSearchParams`. |
| **Dark/light mode** | ThemeProvider with system support, Aurora animation adapts colors per theme. |
