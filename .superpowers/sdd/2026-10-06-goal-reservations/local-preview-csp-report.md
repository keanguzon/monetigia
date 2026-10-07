# Local preview CSP fix

Date: 2026-10-07. Separate root-authorized scope after Task 10 finite-money fix commit `e5683bf`.

Root supplied the user's browser console evidence that Monetigia's `connect-src` header blocked the configured `http://127.0.0.1:55440` disposable API. Existing API connectivity and JWT checks had already succeeded outside the browser. This fixes the application's development header, not browser policy or authentication code.

`next.config.js` now appends only the configured normalized HTTP(S) loopback origin to `connect-src` when `NODE_ENV` is exactly `development`. Accepted hostnames are `localhost`, `127.0.0.1` and `[::1]`; URL canonicalization may normalize equivalent IPv4 spelling to `127.0.0.1`. Unsupported protocols, other hosts, credentials, malformed URLs and raw control/whitespace characters fail closed. Only `URL.origin` enters the header; path, query and fragment never do. Production and other modes preserve the complete prior header bytes. All other CSP directives, including `upgrade-insecure-requests`, and other security headers are unchanged.

TDD RED: `node --test tests/local-preview-csp.test.cjs` exited 1, 2 passed / 2 failed. Development lacked the configured loopback source; preservation/rejection cases already passed.

GREEN: the same command exited 0, 4/4 passed. Cases cover exact port/origin scope, HTTPS localhost, bracketed IPv6, canonical IPv4 and default ports, production/test/unset mode exclusion, nonloopback/lookalike hosts, credentials, malformed URL/protocol/port input, raw header injection and encoded path/query/fragment directives. The actual exported config's `headers()` executes in an isolated process-environment VM; tests do not read or print application environment credentials.

Normal test wiring uses explicit filenames in `package.json` for Windows portability. `npm test` exited 0 with Node 6/6 and Vitest 9 files / 130 tests. `npx tsc --noEmit` exited 0. Owned `git diff --check` exited 0; no runtime test warnings. No dependency or lockfile changes.

Files: `next.config.js`, `tests/local-preview-csp.test.cjs`, `package.json`, this report. No financial implementation or Task 10 review files are included in this commit. No server/process restart, database changes, live services, push, merge or deployment. Root owns preview reload/restart coordination, actual served-header verification and the user's browser retry; automated header assertions are not represented as rendered-browser evidence.
