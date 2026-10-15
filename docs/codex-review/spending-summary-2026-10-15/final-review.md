# Final spending feature review

Reviewed base `d95ec5a` through `c38d422` against the approved October 15 plan, then scoped supplements `15c1f2f` (build repairs) and `9538eb9` (period-selection correction). Review is limited to the spending feature and its existing integration points. No source, branch, index, production, or database mutations were made by this reviewer.

## Strengths

- Server aggregation preserves exact decimal strings, PHP eligibility, owner-scoped joins, uncategorized expenses, separate debt payments, inclusive dates, and explicit rejection of invalid historical amounts. The invoker RPC has bounded ranges and authenticated-only execution.
- Spending and Dashboard reads share the same validated RPC contract and browser-local period boundaries. Owner-aware keys, pinned bearer requests, identity generations, and late-response checks protect the new reads and limit actions across account changes.
- Current summary and comparison errors remain independent. Saved limit writes remain distinct from refresh failures; recovery refreshes the read without replaying a committed mutation.
- History date filtering applies to base pages and refreshes while installment sibling completion stays unbounded and visibly distinguished from period spending. Existing transaction, metadata, debt, and category changes use the shared refresh path.
- New limit RLS policies and grants restrict CRUD to the authenticated owner; numeric constraints and the timestamp trigger are narrowly scoped. The production migration-before-frontend gate remains explicit.

## Issues

### Resolved Important (P2)

1. **Selecting a period kind retains the historical month instead of opening the current period.**
   - File: `src/components/transactions/PeriodBar.tsx:17`
   - `choose()` anchors `periodContaining()` to the selected period's start whenever a period is already selected. On October 15, navigate to September, then select `1st–15th`: it opens September 1–15 rather than October 1–15. Selecting `Month` while browsing a historical cutoff likewise remains historical.
   - The approved Navigation requirement says selecting a period kind opens its current period. Keeping the historical month was documented by the implementer but was not an approved plan deviation. This also prevents the menu from serving as the expected route back to the current cadence and its applicable limit.
   - Anchor menu kind selection to `today`; retain the existing latest-nonfuture second-half fallback before the 16th. Add a focused historical-month/cutoff switch regression. Arrow navigation should continue to move from the viewed period.
   - **Resolved and approved in `9538eb9`:** menu selection now anchors to `today`; the prior-month second-half fallback and viewed-period arrow behavior remain. Three parameterized assertions cover historical September to current Month, current first half, and latest available second half. Executor records behavioral RED (2 failures), then 14 passing focused tests and a passing typecheck. No test rerun was needed for this scoped review.

### Critical

None identified.

### Minor

No load-bearing minor findings. No open findings remain.

## Declined to judge

- Existing generic account/category/recent-transaction cache isolation: explicitly deferred by the plan; the new spending and Dashboard keys were reviewed.
- Existing destructive theme token contrast elsewhere: outside this feature; the scoped spending override and rendered contrast evidence are supplied by the executor.
- Physical Safari/PWA acceptance and old rollout device checks: explicitly remain on the separate rollout track.
- Live production schema parity and migration execution: release gates requiring the user's production action; no production access was attempted.
- Historical limits, FX conversion, category budgets, payday periods, and spending enforcement: explicitly excluded product behavior.
- Generated type configuration, unrelated audit/chat files, and parent documentation edits: excluded from this review as instructed.

## Verification evidence and limits

The executor reports 8 Node checks and 532 Vitest passes with 4 intentional timezone skips, 153 database passes with no skips, and a passing typecheck. Browser evidence covers Dashboard/Transactions parity, period filtering, summary failure independence, retry behavior, current limit overage, keyboard focus return, and mobile overflow. These suites were not repeated by this reviewer. Final build and the remaining browser acceptance work were ongoing at dispatch.

Build supplement `15c1f2f` is approved: JSX apostrophe entities preserve visible strings. The inline dialog effect checks owner, generation, and authentication status directly and preserves attempt invalidation/closing behavior without unstable function dependencies. The executor reports 24 focused passes, typecheck, and clean targeted lint for this repair. The scoped period supplement is approved as described above. These small changes do not warrant repeating the entire database or frontend suite; the final build and browser acceptance remain executor verification gates.

## Assessment

**Code review: APPROVED.** The accounting, auth, cache, and migration architecture are coherent, and the one actionable finding has been fixed and reviewed. Finish the pending build/browser verification before claiming implementation complete; merge, production catalog checks, migration installation, and deployment remain separately gated by the approved plan and user authorization.

## User-directed mobile copy supplement

Scoped review of `copy-review.diff`, commit `82b3e93`: **APPROVED; no new findings.** The user's subsequent request for concise mobile text supersedes the plan's original exact explanatory paragraphs. The subtitle becomes `Expenses + card payments`, the effective totals range remains visible once, and the retained accounting/list explanations move into a native, initially collapsed `How totals work` disclosure. Amounts, calculations, request ranges, limits, and mutations are unchanged. The disclosure has a 44px target and a visible keyboard focus style. The updated focused test checks the concise strings, retained explanations, default closed state, click toggling, and focusability. Executor reports 14 focused passes, typecheck, and zero targeted lint warnings; browser Enter-key/mobile confirmation is underway separately. No full-suite repeat is warranted for this copy and disclosure change.
