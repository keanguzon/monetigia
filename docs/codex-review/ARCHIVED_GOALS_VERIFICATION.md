# Archived goals release verification

Date: 2026-10-08

## Behavior
Settings lists archived goals using the signed-in finance snapshot. Restore clears archived_at, preserves completed/cancelled status, completion time, wallet balances, transactions and allocation history. Reopen remains a separate Goals action. Unknown save retries reuse the request ID; saved-but-refresh-failed goals cannot submit another restore. Pending feedback is scoped by user.

## Evidence
- npm test: 7 Node tests and 214 Vitest tests passed.
- Disposable database suite: 86/86 passed. Final authenticated-only grant refinement: focused 7/7 passed again.
- npx tsc --noEmit: passed.
- npm run lint: passed with five pre-existing hook dependency warnings.
- npm run build: passed, all 20 pages generated. Existing Browserslist warning remains.
- Independent source review: backend owner checks, deterministic locks, replay, zero reservations, grants and frontend retry/session handling reviewed.

## Design and limits
Existing Settings section grid, type, theme tokens and spacing are reused to preserve the product design. Archive metadata uses wrapping rows; Restore uses the established outline button with a 44px target. ENERGY 1 / RHYTHM 1 / MOTION 1 matches the current Settings design. No decorative motion was added.

Automated Settings tests cover loading, empty, error, restore, duplicate click, uncertain outcome, refresh failure and user changes. Browser preview tool timed out, so live visual inspection at mobile/desktop widths is not claimed. Visual QA remains to be completed.

## Release order
Apply supabase/migrations/202610080001_archived_goal_restore.sql in production before pushing dependent frontend. This migration creates one authenticated RPC and does not reset or remove user records. Production database application has not yet been confirmed. Push/deployment is pending that prerequisite.
