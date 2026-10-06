# Task 6 report: typed transport, shared snapshots, and reliable refresh

## Implemented

- Added a Zod-validated RPC client for finance snapshots, transaction quotes, and financial commands. It sends canonical decimal strings, preserves named SQL codes and `HINT` text, and marks transport failures, status-0 responses, ambiguous server failures, and invalid write responses as unknown outcomes.
- Added the `useGoalFinance(userId)` SWR hook with per-user snapshot keys, matching-user display gating, cache refresh for goal history and existing finance views, and cache data clearing on sign-out.
- Changed `useGoals` to consume the authoritative snapshot. The existing numeric display shape remains available through an explicit bridge, while projection calculations use retained canonical strings. Fetching no longer writes automatic completion changes; archived goals are excluded from the UI list. Goal metadata edits remain direct metadata writes; archive, close, and reopen use financial commands.
- Kept command application separate from revalidation. `applyAndRefreshFinancialCommand` returns the committed result alongside a refresh error, so refresh failure cannot turn a committed command into a failed save or create a new request ID.
- Updated contribution fixtures to use UUIDs and full snapshot DTOs. Legacy tagged expense and transfer history no longer increases goal progress.

## TDD and verification

RED command, before implementation:

```text
npx vitest run tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx
```

Output: 2 suites failed during import resolution because `src/lib/goals/client.ts` and `src/hooks/use-goal-finance.ts` did not exist; 0 tests ran. This was the expected missing-feature failure.

Focused GREEN command after implementation and compatibility fixes:

```text
npx vitest run tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx tests/goal-summary.test.ts tests/contributions.test.tsx
```

Output: 4 test files passed, 56/56 tests passed.

Final full suite:

```text
npm test
```

Output: navigation checks 2/2 passed; Vitest 5/5 files and 58/58 tests passed.

TypeScript check:

```text
npx tsc --noEmit
```

Output: exit code 0, no diagnostics.

`git diff --check` reported no whitespace errors. One earlier full-suite run exposed a legacy projection caller without the new exact-amount bridge; the explicit `parseMoney` fallback fixed it, and the focused and final full suites passed afterward.

## Files changed

- `src/lib/goals/client.ts`
- `src/hooks/use-goal-finance.ts`
- `src/hooks/use-goals.ts`
- `src/lib/refresh-financial-data.ts`
- `tests/goal-finance-client.test.ts`
- `tests/goal-finance-hooks.test.tsx`
- `tests/contributions.test.tsx`

## Self-review and concerns

- Caller-provided request IDs are validated and passed through unchanged. A replay therefore uses the caller's same UUID. PostgREST status `0` and other ambiguous outcomes stay distinguishable from named server rejections.
- Goal closure currently submits `leftovers: null`; if reservations remain, the server rejects closure instead of silently releasing them. Task 7 should provide the explicit leftover choice UI.
- The typed allocation event schema expects canonical decimal strings. Task 7's history reader should normalize valid database decimal text such as `0` to two decimal places using string operations, without float conversion, before parsing events.
- Transaction entry remains on its existing path for Task 8 to migrate to the command and quote flow.

## Review fix round 1

Addressed the independent review findings:

- Bound each user-scoped snapshot RPC to the access token captured for that request, then rechecked the user, token, request selection revision, and returned goal ownership before accepting the response. This also rejects an older request after a user1 → user2 → user1 switch.
- Kept `getProjection` comparisons in canonical centavos, including fully funded checks. The numeric compatibility fallback is used only when legacy callers have no canonical amount bridge.
- Made refresh clear the prior SWR error while retaining cached data, await revalidation, and inspect the current scoped cache error. This detects the same reused `Error` instance. `applyAndRefreshFinancialCommand` now requires a refresh callback so command callers use a hook-scoped refresh with observable errors; the legacy global helper remains for refresh-only paths and documents its cache limitation.
- Updated the contribution test client fixture for session-bound snapshot requests while preserving its association, reset, cancellation, installment, and navigation coverage.

RED evidence:

```text
npx vitest run tests/goal-summary.test.ts tests/goal-finance-hooks.test.tsx
```

Output: 1 failing projection case (expected count 1, received 0); the existing hook cases passed. The canonical display values collapsed to the same JavaScript number at the safe-centavo boundary.

```text
npx vitest run tests/goal-finance-hooks.test.tsx -t "repeated real SWR"
```

Output: 1 failing test; the second real mounted-hook revalidation returned `refreshError: null` while SWR retained the same `Error` instance.

GREEN and final verification:

```text
npx vitest run tests/goal-summary.test.ts tests/goal-finance-hooks.test.tsx tests/goal-finance-client.test.ts
```

Output: 3 test files passed, 53/53 tests passed.

```text
npm test
```

Output: navigation checks 2/2 passed; Vitest 5/5 files and 63/63 tests passed.

```text
npx tsc --noEmit
```

Output: exit code 0, no diagnostics.

```text
npx vitest run tests/contributions.test.tsx
```

Output: 1 test file passed, 8/8 tests passed after adding the session-bound RPC behavior to its fixture.

Files additionally changed in this round: `src/hooks/use-goal-finance.ts`, `src/hooks/use-goals.ts`, `src/lib/refresh-financial-data.ts`, `tests/goal-finance-hooks.test.tsx`, `tests/goal-summary.test.ts`, and `tests/contributions.test.tsx`.

No remaining concerns identified within Task 6. Future save flows should pass `useGoalFinance().refresh` into `applyAndRefreshFinancialCommand`; the no-cache global helper is for legacy refresh-only flows and cannot report per-key revalidation errors.
