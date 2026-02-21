# Security Hardening Plan (SAST) — Buko Juice (Next.js + Supabase)

Date: 2026-02-21  
Scope: full workspace (`src/**`, Supabase SQL in `supabase/**`, config files).

This document captures the static application security review findings and a concrete remediation plan. It is intentionally “fix-focused”: each issue includes why it matters and production-ready code replacements.

> Note: I previously listed some broad risks before verifying the code. This plan is the verified, file-specific version based on scanning and reading the actual implementation.

---

## 0) Audit method (what was scanned)

- Grep/semantic scan for:
  - secrets and key material (`*_KEY`, `PRIVATE_KEY`, etc.)
  - DOM XSS sinks (`dangerouslySetInnerHTML`, inline `<script>` interpolation)
  - auth/session usage (`getSession()`, `getUser()`)
  - redirects (`searchParams.get("redirect")`, `NextResponse.redirect`)
  - Supabase query-string filters with interpolation (`.or(`...${id}...`)`)
- Manual review of key routes:
  - `src/app/auth/callback/route.ts`
  - `src/app/api/**/route.ts`
  - `src/app/login/page.tsx`
  - `src/app/(dashboard)/settings/page.tsx`

---

## 1) Hardcoded secrets / credentials

### Finding 1.1 — No hardcoded production secrets found in code

- I did **not** find real API keys or credentials committed in TS/TSX files.
- References to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` appear in code and in `README.md` as placeholders.

**Risk**
- Low (assuming `.env.local` is not committed). The primary risk is accidental secret leakage through error messages or client exposure.

**Action**
- Ensure `.env*` is gitignored and that `SUPABASE_SERVICE_ROLE_KEY` is never prefixed with `NEXT_PUBLIC_`.

---

## 2) Injection flaws (XSS / query injection / command injection)

### Finding 2.1 — Inline `<script>` interpolation in OAuth callback can enable script-breakout XSS

**File**
- `src/app/auth/callback/route.ts`

**What happens**
- The route returns HTML for popup flows with an inline `<script>` block.
- It interpolates `error.message`, `requestUrl.origin`, and `redirect` via `JSON.stringify(...)` directly into the script.

**Why this is risky**
- `JSON.stringify` does **not** prevent `</script>` injection. If a value contains `</script>` (or certain Unicode separators), it can terminate the script block and inject arbitrary HTML/JS.

**Secure fix (production-ready replacement)**

Add two helpers:

```ts
function escapeJsonForInlineScript(json: string): string {
  // json is already JSON.stringify(...) output
  // Prevent closing script tags + problematic Unicode separators
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  // Allow only same-site relative paths
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
}
```

Then update the route:

```ts
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = sanitizeRedirect(requestUrl.searchParams.get("redirect"), "/dashboard");
  const isPopup = requestUrl.searchParams.get("popup") === "1";

  // ...existing code...

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error && isPopup) {
      const safeMessage = escapeJsonForInlineScript(JSON.stringify(error.message));
      const safeOrigin = escapeJsonForInlineScript(JSON.stringify(requestUrl.origin));

      const html = `<!doctype html>
<html>
  <head>...</head>
  <body>
    <script>
      (function () {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'oauth-error', message: ${safeMessage} }, ${safeOrigin});
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
      })();
    </script>
    <p>Sign in failed. You can close this window.</p>
  </body>
</html>`;

      // ...existing response building...
    }

    if (isPopup) {
      const safeOrigin = escapeJsonForInlineScript(JSON.stringify(requestUrl.origin));
      const safeRedirect = escapeJsonForInlineScript(JSON.stringify(redirect));

      const html = `<!doctype html>
<html>
  <head>...</head>
  <body>
    <script>
      (function () {
        var origin = ${safeOrigin};
        var redirectTo = ${safeRedirect};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'oauth-success', redirect: redirectTo }, origin);
          }
        } catch (e) {}
        setTimeout(function () {
          try { window.close(); } catch (e) {}
          try { window.location.replace(redirectTo); } catch (e) {}
        }, 250);
      })();
    </script>
    <p>Signed in. You can close this window.</p>
  </body>
</html>`;

      // ...existing response building...
    }
  }

  // IMPORTANT: use the sanitized redirect
  const response = NextResponse.redirect(new URL(redirect, requestUrl.origin));
  // ...existing cookie set...
  return response;
}
```

---

### Finding 2.2 — Open redirect via `redirect` query param (server + client)

**Files**
- `src/app/auth/callback/route.ts`
- `src/app/login/page.tsx`

**Why this is risky**
- `new URL(redirect, requestUrl.origin)` will follow absolute URLs (`https://evil.com`).
- On the client, `router.push(redirectTo)` can also navigate to an attacker-controlled destination if `redirect` is not validated.

**Secure fix**
- Reuse the same `sanitizeRedirect(...)` logic on both server and client.

Client-side safe redirect (example patch for login page):

```ts
function sanitizeRedirectClient(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  return raw;
}

const redirectTo = sanitizeRedirectClient(searchParams.get("redirect"), "/dashboard");
```

---

### Finding 2.3 — Supabase filter-string interpolation (`.or(`...${id}...`)`) can broaden queries if attacker-controlled

**Files (examples)**
- `src/components/forms/AddTransactionForm.tsx`
- `src/components/transactions/AddTransactionModal.tsx`
- `src/app/(dashboard)/categories/page.tsx`

**Why this is risky**
- Supabase `.or()` takes a **string** with a mini-language. If an attacker can influence the interpolated value, it may change the intended filter.

**Reality check in this repo**
- These IDs appear to come from authenticated user data (accounts/categories), so direct attacker control is limited.

**Harden anyway**
- Validate UUID format before interpolating.

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID.test(creditId)) throw new Error("Invalid account id");
```

---

## 3) Broken authentication / insecure session management

### Finding 3.1 — `getSession()` used for authorization-sensitive flows (Settings)

**File**
- `src/app/(dashboard)/settings/page.tsx`

**Why this is risky**
- `supabase.auth.getSession()` reads local session state; it’s not a strong primitive for authorization decisions.
- Multiple write operations use `session.user.id` as the source of truth.

**Secure fix**
- Prefer `supabase.auth.getUser()` for “who is this” decisions and for any write keyed by user identity.

Example replacement pattern:

```ts
const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) throw new Error("Not authenticated");

// use user.id and user.email
```

Where to apply:
- `loadProfile`
- `handleSaveProfile`
- `handleSaveCurrency`
- `handleAvatarUpload`
- `handleChangePassword` (when reading email)
- `sendPasswordSetupLink`

---

## 4) IDOR / Missing authorization checks

### Finding 4.1 — Most data access appears user-scoped in queries, but authorization relies heavily on Supabase RLS

**Observation**
- Many client-side queries filter by `user.id`. That’s good, but **RLS must be the primary enforcement**.

**Risk**
- If RLS policies are missing or too broad, client-side checks do not prevent direct API calls.

**Action**
- Confirm RLS policies exist for `accounts`, `transactions`, `categories`, `users`, `user_preferences`:
  - `SELECT/INSERT/UPDATE/DELETE` should be limited to `auth.uid() = user_id` (or equivalent).
  - Default/shared categories must be immutable to regular users.

**Concrete defensive coding (optional, defense-in-depth)**
- Validate UUIDs for any “mutate-by-id” operation in the UI before sending a request.

---

## 5) Misconfigured CORS / insecure headers / exposed sensitive routes

### Finding 5.1 — Service-role-backed endpoints return overly detailed configuration errors

**Files**
- `src/app/api/auth/check-availability/route.ts`
- `src/app/api/storage/ensure-profiles-bucket/route.ts`
- `src/app/api/user/upload-avatar/route.ts`

**Why this is risky**
- Error bodies disclose internal configuration/state and encourage targeted attacks.

**Secure fix**
- Return generic error messages to clients; log detailed errors server-side only.

Example replacement:

```ts
if (!url || !serviceKey) {
  console.error("Missing required Supabase env vars");
  return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
}
```

---

### Finding 5.2 — User enumeration endpoint (`check-availability`) uses Service Role

**File**
- `src/app/api/auth/check-availability/route.ts`

**Why this is risky**
- Returns `emailExists` / `usernameExists`. This supports credential stuffing and targeted phishing.

**Secure fix options**
- Best: remove/avoid enumeration and do availability checks at signup only.
- If you must keep it:
  - add rate limiting
  - add origin checks
  - make responses less enumerable (e.g., always return 200 with a generic message; only block on the register endpoint)

**Rate limiting**
- Requires either a dependency (preferred in production) or an in-memory limiter (acceptable only for single-instance dev).

> Dependency audit note: I will ask for permission before running `npm audit` or installing any package.

---

### Finding 5.3 — CSRF defense for cookie-authenticated POST routes

**Files**
- `src/app/api/delete-account/route.ts`
- `src/app/api/user/upload-avatar/route.ts`
- `src/app/api/auth/check-availability/route.ts` (less critical but still useful)

**Why this is risky**
- If cookies are sent cross-site in any scenario (misconfig, older browsers, same-site exceptions), state-changing endpoints can be hit by third-party origins.

**Secure fix (origin allowlist)**

Create a helper:

```ts
// src/lib/security/origin.ts
export function assertSameOrigin(request: Request) {
  if (process.env.NODE_ENV === "development") return;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) throw new Error("forbidden");

  const originUrl = new URL(origin);
  if (originUrl.host !== host) throw new Error("forbidden");
}
```

Use it early in each POST handler:

```ts
try {
  assertSameOrigin(request);
} catch {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

---

## 6) File upload hardening

### Finding 6.1 — `upload-avatar` route does not validate MIME, path prefix, or extension

**File**
- `src/app/api/user/upload-avatar/route.ts`

**Why this is risky**
- You rely on storage bucket MIME allowlist, but the API route should enforce:
  - file size
  - MIME type
  - path prefix (`avatars/`)
  - no traversal (`..`)

**Secure fix**

```ts
const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
if (!allowed.has(file.type)) {
  return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
}
if (file.size > 2 * 1024 * 1024) {
  return NextResponse.json({ error: "File too large" }, { status: 400 });
}
if (path.includes("..") || !path.startsWith("avatars/")) {
  return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
}
```

---

## 7) Platform hardening (HTTP security headers)

### Finding 7.1 — No explicit security headers in `next.config.js`

**File**
- `next.config.js`

**Why this is risky**
- Missing defense-in-depth controls like clickjacking protection and `nosniff`.

**Fix (minimal, safe defaults)**

```js
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ];
}
```

(You can add CSP later, but CSP requires careful tuning for Supabase/OAuth flows.)

---

## 8) Dependency audit (requires permission)

If you want me to check third-party risks, I can run:
- `npm audit --production`
- `npm outdated`

**Permission needed before running shell commands.**

---

## 9) Execution order (priority)

1. Fix open redirect + inline-script escaping in `auth/callback` (highest impact).
2. Harden login redirect handling.
3. Reduce info leaks from service-role routes and standardize generic 503/500 errors.
4. Add origin checks to sensitive POST endpoints.
5. Add rate limiting (at least for `check-availability` and `delete-account`).
6. Harden file upload route validation.
7. Replace `getSession()` usage in Settings with `getUser()` where identity is used for writes.
8. Add basic security headers.

---

## Appendix A — “As any” Supabase usage (type-safety)

**Observation**
- Multiple files use `supabase as any` / `const sb = supabase as any`.

**Why it matters**
- Not a direct vulnerability by itself, but it can mask authorization bugs, incorrect filters, and data integrity issues.

**Action**
- Consider typing the Supabase client using `Database` from `src/types/database.ts` and deleting `as any` usages.
