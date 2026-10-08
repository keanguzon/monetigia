# Beta 1.1 transfer checkpoint — 2026-10-08

This is a backup checkpoint, not a production release. Coding is paused at the user's request. Do not reset any database or discard dummy data.

## Current work

Task 5.2a correction contracts were committed at b316c40. Task 5.2b implements the private atomic debt correction handler, guarded public dispatcher patch, and database tests. Its independent review is still outstanding. Read `pending-rollout/task-5-2b-report.md` and inspect the actual diff before proceeding. No production SQL was executed for 5.2b.

Authoritative plan: `docs/superpowers/plans/2026-10-08-pending-rollout.md`. Detailed debt requirements: `docs/superpowers/plans/2026-10-07-existing-debt-selection.md` and the matching specification in `docs/superpowers/specs`.

Next, when the user authorizes coding: review 5.2b, then complete Tasks 6a/6b (debt snapshot, legacy adoption, existing debt forms), 7 (selection and unpaid corrections), 8 (description/title editing), and 9 (integrated verification and rollout). Check actual implementation before repeating any checklist item. Landing redesign remains deferred.

## Agent policy

Preferred architecture when available: Sol 6.1 plans/orchestrates and Sol 6.1 Light reviews. The user is now on a Free plan where Sol is unavailable and resumed with Luna. Use models actually available; do not block waiting for Sol or pretend a delegation happened. Gemini Flash High is paused by the latest user instruction after quota/503/transport errors. Use scoped Luna Max for coding only after the user authorizes continuation; if no separate reviewer is available, report that and make the review limitation explicit. No Astra. Do not run two coders against the same scope.

Gemini previously encountered 429 quota errors, 503 demand errors, and a disconnected MCP transport. The transport's exact cause was not diagnosed. One overly broad SQL proposal was rejected before application. Do not describe those errors as fixed without checking the bridge.

## Preserve these requirements

- Opening debt is separate from purchase/payment history; never fabricate historical transactions.
- Counts must be whole positive integers; support 2, 24, and 600 months with required first due date and exact centavo totals.
- Payments use global dated FIFO, then undated debt; preserve payment dates and reject overpayments atomically.
- Corrections affect only current unpaid selected debt in one group. Preserve purchases and paid history; never invent cash reimbursement.
- Lock the authenticated owner before idempotency lookup. Replay identical completed requests before stale checks; reuse the same request ID after unknown outcomes.
- Mobile navigation uses five equal icon-only slots, home glyph, bright primary green selection, transparent liquid glass, and Settings via profile. Preserve accepted desktop behavior.
- Mobile loading uses the top progress indicator, immediate selected navigation, bounded skeleton, centered unboxed error and retry. Mobile sort/filter sits at the far right.
- Archived Goals and Restore belong in Settings; restoring and reopening are separate actions.
- Existing mobile navigation/filter/recovery and overspend popup were implemented and manually accepted. Physical Safari/PWA and production tab-return checks must not be claimed from desktop tests.

## Transfer

Clone branch `beta-1.1`, run `npm ci`, and restore the private `.env`. Global skills are in the local backup's `global-skills`; copy them into the new user's `.agents/skills`. Project skills are tracked in this repository. Read AGENTS.md and retain antislop `during` as the session choice.

The local ZIP contains private setup and data exports. Keep it private. Do not commit those files. Codex login credentials are deliberately excluded: sign in again on the new PC. MCP config is a reference, not something to overwrite blindly; update absolute paths and reinstall dependencies. Application bundled skills/plugins are installed through the new Codex app.

The disposable DB harness is outside this repository on the old PC. The ZIP contains its runtime files and a logical dump when available. Restore only into a fresh local disposable database, never production. Existing cloud Supabase data stays on Supabase; Git is not a database backup.

Git and the handoff transfer files and working context. The chat share snapshot is read-only; it does not import a live editable chat or active agents. Start a new chat using RESUME_BETA_1_1_PROMPT.md.
