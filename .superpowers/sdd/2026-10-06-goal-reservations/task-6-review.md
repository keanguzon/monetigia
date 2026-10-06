# Task 6 independent review (initial)

Base: `07bcbbd` · Head: `f659cd2` · Reviewer: GPT-6-luna high.

Spec compliance: Changes requested. Quality: Needs fixes.

## Findings

- Important: `src/hooks/use-goal-finance.ts:12` fetches using the current asynchronous Supabase session without binding it to the SWR user key. A session switch can cache another user's snapshot under the earlier key. Prevent mismatched/superseded responses from populating the cache.
- Important: `src/hooks/use-goals.ts:27` uses numeric display values for projection comparisons and early-branch calculations. Use canonical amounts throughout; nearby centavo values can collapse to the same display number.
- Critical: none. Minor: none.

The reviewer accepted parsing, named SQL errors/hints, unknown write outcomes, supplied request UUIDs, read-only snapshot fetches, and lifecycle routing. Existing evidence: 58 Vitest + 2 Node tests and TypeScript passed; reviewer did not rerun suites.

## Additional controller evidence

Installed SWR `dist/index/index.js:475` catches revalidation failures and resolves after storing the error. Its internal mutation revalidator returns cached data. Therefore the existing mocked mutation rejection does not establish saved-but-refresh-failed behavior with a real mounted hook. Fix round 1 also addresses this verified acceptance gap and adds a real SWR regression test.
