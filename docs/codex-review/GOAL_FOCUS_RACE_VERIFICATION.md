# Goal snapshot tab-return race

## Problem and fix

The user reported Goals intermittently showing a load error after returning from another browser tab, despite successful HTTP 200 snapshot requests. Supabase's installed auth client recovers the session on visibility return and can emit SIGNED_IN for the unchanged session. The finance hook previously advanced its session revision for every non-initial auth event, discarding an otherwise valid in-flight snapshot.

The hook now ignores only repeated SIGNED_IN events with an identical user ID and access token. Actual sign-out, user changes, token changes and other auth events retain invalidation. Token-bound response validation in the API client is unchanged. No database data, migrations, balances, reservations or transactions are modified by this fix.

## Evidence

- A deferred snapshot revalidation begins with cached wallet value 100.00. An unchanged-session SIGNED_IN arrives while the request is pending. The regression requires the newly returned 200.00 to populate the cache without an error. It fails against the original callback and passes with the fix.
- Separate regressions retain rejection across sign-out/re-sign-in even with the same token, and across a refreshed token. Existing cross-user and delayed-response tests remain in place.
- Focused hook/client run: 19 tests passed. Root full suite: 204 Vitest tests across 17 files plus 7 Node tests, exit 0. Typecheck and lint succeeded; lint retains five existing hook-dependency warnings.
- Sol medium reviewed the final hook/test diff and reported no actionable findings. Source and tests were reviewed; reviewer did not run tests.
- Production build on the final unchanged source exited 0 and generated 20 pages. Existing font-metric, Supabase Edge API, Webpack cache and Browserslist notices remain nonfatal; no new dependency was introduced.

## Limits and acceptance

This deterministically reproduces the duplicate auth-event race; it does not establish that every possible production loading failure has the same cause. True API failures and superseded-token requests remain errors. After deployment, leave Goals open, switch to another tab and return several times without refreshing; the list should remain available for the same session. Repeat after a longer idle period to check actual token refresh separately. Do not change financial data merely to test tab focus.

The user reported applying the seven migration files manually and verified required columns/function exist, then confirmed Transactions loads. Those are user-reported production results, not automated deployment verification. Record counts and balances still need comparison against saved exports; no reset is authorized.
