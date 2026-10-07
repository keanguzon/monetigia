# Local preview CSP fix review

- Base: `e5683bf`
- Head: `05dbd1967548522123c6f87e28f119aa78e38f8f`

## Verdict

**PASS — ready for the intended development configuration fix.** The change matches the bounded requirement: it adds only a parsed HTTP(S) loopback origin from the configured URL to `connect-src`, only when `NODE_ENV` is exactly `development`. Outside that case, the prior headers are byte-equivalent. The existing CSP directives and other security headers are preserved.

## Findings

No in-diff correctness or security findings.

## Scope and evidence

Reviewed only the packaged CSP change in `next.config.js`, its four focused Node tests, and the `package.json` test wiring. URL parsing rejects unsupported schemes, credentials, malformed/control-character input, and host lookalikes; interpolation uses `URL.origin`, so URL path/query/fragment values cannot add directives. Tests compare the complete policy for accepted cases and complete header objects for excluded cases. The package records `npm test` and TypeScript checks passing; this review did not rerun them.

The package also records a served HTTP 200 response whose CSP contains `http://127.0.0.1:55440`. A rendered browser retry remains outstanding, so browser acceptance is not established by this review. The existing `upgrade-insecure-requests` directive is intentionally unchanged per scope; the browser retry is the evidence needed to close that runtime question.

Concurrent Task 10 worktree changes were excluded from this review.

## Follow-up: preserve HTTP loopback API requests in development

A later authenticated browser trace received `OPTIONS 204` for the configured loopback API but showed no subsequent auth-user read or finance RPC. Since the served policy already allowed the exact API origin, the remaining `upgrade-insecure-requests` directive became the likely cause: it can rewrite the configured `http://` fetch to HTTPS before the request reaches the local service. This is an inference from the browser trace and current header, not a confirmed browser result.

The development policy now omits that directive only when the validated configured Supabase URL uses `http:` and an allowed loopback hostname. HTTPS loopback keeps the directive; production, other modes, malformed or nonloopback URLs, and a missing API URL retain the prior policy bytes. No other CSP directive or security header changed.

TDD RED: `node --test tests/local-preview-csp.test.cjs` exited 1, 3/5 passed. The two new HTTP loopback assertions failed because `upgrade-insecure-requests` was still present.

GREEN: the same focused command exited 0, 5/5 passed, including byte-equivalent production/nondevelopment headers, HTTPS loopback retention, no-API behavior, and rejected origins. Full `npm test` exited 0: Node 7/7 and Vitest 9 files / 130 tests passed. No TypeScript sources changed, so no separate typecheck was required. The owned Next process was not restarted; root will apply the committed config and perform the browser retry. That retry must establish the auth-user read and account/RPC requests before claiming rendered acceptance.

## Follow-up disposition

The owned preview services were restarted and the ignored local PostgREST proxy CORS allowlist was updated to permit its required `accept-profile` and `content-profile` headers. A fresh scoped review of the HTTP-upgrade follow-up commit `8cb894c` passed without findings; focused CSP tests passed 5/5.

The regular browser now authenticates and renders the disposable Dashboard account data and Wallet tiles. The Wallets `goal_finance_snapshot` POST returns HTTP 200, but the Wallets finance summary still displays `Unavailable`. This is a confirmed remaining preview issue, not a CSP/authentication failure, and is not claimed as resolved. Full viewport/lifecycle rendered acceptance was not performed because the user set the stop boundary at Task 10.

The local preview remains available. No production configuration, live database, push, merge, or deployment was changed.
