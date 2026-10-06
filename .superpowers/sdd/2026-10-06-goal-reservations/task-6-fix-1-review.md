# Task 6 fix round 1 scoped review

Base: `f659cd2` · Head: `d4dbe29` · Reviewer: GPT-6-luna high.

All findings addressed; no new Critical/Important breakage. No suites rerun by reviewer.

- Auth isolation: captured session token is bound to the snapshot request; session/selection changes and mismatched ownership reject the response before cache population. Delayed session and switch-back regressions added.
- Exact projections: canonical centavo comparisons replace display-number early checks/calculations; numeric fallback remains only for legacy callers without exact amounts.
- Refresh observability: scoped refresh preserves cached data, clears prior error state, awaits revalidation, and checks current cache errors. Real mounted SWR tests include repeated failures using the same Error instance. The committed result remains saved alongside refreshError.

Reported fresh checks: 63/63 Vitest tests, 2/2 Node navigation checks, TypeScript exit 0. Future command flows must supply the hook-scoped refresh callback.
