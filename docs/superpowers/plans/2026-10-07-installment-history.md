# Installment History and Dates Implementation Plan

> **For agentic workers:** Use subagent-driven-development with task review, or executing-plans if delegation is unavailable.

**Goal:** Group credit installments under their purchase and distinguish transaction dates from payment due dates.

**Architecture:** Retain existing installment debt rows and atomic financial commands so debt accounting is not charged twice. Add explicit purchase grouping/transaction-date metadata and a separate firstDueDate on installment drafts. Monthly due dates are calculated from the original first due date, capped at each month's last day. Group presentation consumes stable purchase identity, never description matching.

**Tech Stack:** Next.js 14, React, Radix, Tailwind, Zod, Supabase/PostgreSQL, Vitest.

**Spec:** User-approved decisions in this document, confirmed October 7, 2026.

**Design Read:** Preserve Monetigia's Goals reference: Manrope body, Bricolage financial headings, subtle bordered surfaces, and one shared bright green for primary actions. Separate purchase inputs from the repayment schedule so dates cannot be confused. Group expansion exposes detail without crowding the history. ENERGY 1 / RHYTHM 2 / MOTION 1; motion only communicates pending state or expansion. Existing directional icons identify income/expense/transfer; chevrons identify schedule disclosure.

## Approved behavior

- Purchase transaction date defaults to local today and remains editable. Cash expenses, income and debt payments save the chosen date rather than overriding it with a billing month.
- Credit installment First payment due date defaults one calendar month after purchase date and remains editable. Oct 6 purchase -> Nov 6 first due. An explicitly edited due date must not be overwritten by later unrelated edits.
- Due dates use original day: Jan 31 -> Feb 28/29 -> Mar 31. Preview matches backend exact centavo splitting.
- Transactions display one expandable purchase group, with individual installments inside. Group total is the sum of remaining underlying rows; preserve per-installment deletion initially with explicit wording. No extra financial purchase row is inserted.
- Sort selector: Date added (newest first, default) and Transaction date (newest first). Group transaction date uses purchase metadata; individual due dates do not control main purchase ordering.
- Entire history remains accessible through Load more in bounded batches of 50 source rows. Server sorting uses a stable ID tie-breaker; hydrate complete group schedules and deduplicate rows/groups across batches. Do not eagerly fetch an unbounded ledger.
- Existing installment rows are grouped only through authoritative operation transaction IDs or explicit metadata. Never infer a group from identical descriptions/timestamps. Preserve old schedule dates and debt amounts.
- Modal retains the existing fonts, primary green and subtle surfaces. Clearly separate Purchase details and Payment schedule, show estimated/editable lender guidance and schedule preview. 44px touch targets, light/dark contrast, keyboard and mobile scrolling.

## Constraints

- Worktree C:/Users/PC/.codex/worktrees/goal-reservations/monetigia, codex/goal-reservations. Preserve existing uncommitted QA/UI fixes. No push, merge or deployment.
- This executes installment scope only; overspend popup, archive restore, glass navigation and Settings remain separate follow-ups.
- Keep debt, reservations, installment deletion, auth/RLS, replay and stale quote behavior intact. Add migrations rather than editing applied history.
- No automatic guesses for historical purchase date when operation metadata cannot prove it; show legacy fallback honestly.

## Task 1: Separate date contract and storage

**Files:** src/lib/goals/contracts.ts; new supabase/migrations migration; existing database tests and client contract tests.

- [x] Add failing tests for firstDueDate validation, separate purchase/debt-payment dates, end-of-month and leap year behavior, centavo split, replay and owner restrictions.
- [x] Extend installment drafts compatibly with optional firstDueDate for old callers. Add authoritative installment group/purchase date metadata on transactions, and write it in the existing atomic lane. Backfill groups only from proven financial_operations result IDs; retain existing debt schedule dates.
- [x] Backend generates schedules from firstDueDate (legacy callers fall back to their current draft date), preserving original anchor day and existing amount/debt accounting.
- [x] Expose safe read metadata in types/queries; no client direct financial writes. Verify DB tests and contracts before review.

## Task 2: Purchase modal and dates

**Files:** AddTransactionModal.tsx, standalone transaction form discovered during implementation, new src/lib/transactions/installment-dates.ts, focused contributions tests.

- [x] Test local current date, default first due one month later, edited due preservation, reopening reset, debt-payment chosen date, schedule preview and form submission.
- [x] Replace Start month with First payment due date for purchases. Derive debt-payment breakdown month from the chosen actual payment date; remove the independent billing-month selector so the existing ledger cannot imply allocation to a different month. Separate historical billing attribution is deferred.
- [x] Improve modal hierarchy and payment preview using shared presentation styles. Avoid unrelated form redesign or accounting changes.
- [x] Verify Expense/Income/Transfer, credit installments, failed saves and automatic close; review.

## Task 3: Grouped history and sorting

**Files:** transactions/page.tsx, new src/lib/transactions/history.ts, grouped row component if appropriate; focused behavior tests.

- [x] Test stable grouping, independent same-name purchases, both sort modes, search matching children, remaining totals after deletion, legacy fallback, incomplete group pagination and keyboard expansion.
- [x] Render expandable purchase group with remaining scheduled amount/date and installment schedule; child deletion explicitly deletes only that installment. Maintain ordinary transaction detail/actions.
- [x] Default query/order to Date added. Ensure groups do not silently truncate at the existing 50-row limit; load all children for groups included in the result using owner-scoped queries.
- [x] Add Load more, loading/error retry states, deduplication, and reset behavior when sorting or refreshing after mutations so history is not permanently limited to 50 rows.
- [x] Verify client data fixtures and production queries remain compatible; review.

## Task 4: Acceptance

- [x] Run TypeScript, tests, DB tests, lint and isolated production build without breaking active preview.
- [x] Verify rendered narrow/desktop, light/dark, keyboard, Jan31/February and three-installment purchase sorting. Record actual evidence and limitations.
- [x] Update this plan and parent follow-up plan. Commit only reviewed relevant files if authorized; no remote actions.

## Review focus

- No duplicate debt charge from group presentation.
- UTC midnight must not shift user's default local date.
- Original day restored after short month.
- Group identity/metadata cannot cross users or confuse independent purchases.
- Deleting one installment updates its group without erasing siblings or reservations.

## Final user refinements

- Whole installment header toggles its schedule; minimal unboxed chevron at the far right, accessible Enter/Space and ARIA state retained.
- Shared dropdown arrow inset keeps native and custom select arrows away from the right border; preserve selection, disabled states and keyboard behavior.
- Make changed primary button and financial amount text readable in both themes without changing financial semantics.

- Schedule body expands and collapses with a brief height/opacity transition; reduced-motion preference removes movement, and collapsed child actions remain unavailable to keyboard and assistive technology.


Final evidence: docs/codex-review/INSTALLMENT_HISTORY_VERIFICATION.md. Latest instruction: local commit, user QA, then push; no merge or deployment. Subtle pressed brightness retained without scale.
