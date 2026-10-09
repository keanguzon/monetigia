# Beta 1.1 execution checkpoint, 2026-10-09

## Current status, superseding the historical transfer notes below

Task 6 was completed and reviewed before this continuation. Tasks 7.1, 7.2, 8.1 and 8.2 are implemented and committed: e6888d3, 2bdd3e0, d7714f3 and 495465c. Task 9's Sol 6.1 medium review found a count-one description baseline issue; the bounded fix and missing pagination race coverage are committed at f26b845. Minimal per-task Sol 6.1 low reviews and their fixes are recorded in pending-rollout/task-7-2-review.md, task-8-1-review.md and task-8-2-review.md.

Fresh Task 9.1 checks passed: seven Node tests, 429 Vitest tests, 135 disposable DB tests plus six final-installed-state checks, typecheck, lint and build. After the UI-only review fix, 42 affected tests, typecheck and production build passed. The detailed verification record distinguishes automated, rendered, device and production evidence. Task 9.2 browser evidence is recorded; outstanding device/zoom/recovery coverage must not be called complete.

Current workflow: Sol 6.1 high scoped planning, Luna max coding, one minimal Sol low review per coding unit, Sol 6.1 medium integrated Task 9 review. Gemini remains paused; landing redesign remains deferred. User authorized continuing through Task 9 then QA. Preserve all data and unrelated files; no production resets.

Production additive migration 202610080006_transaction_description.sql is not verified as applied. It follows the already listed migrations 060001–060006, 070001 and 080001–080005. No new frontend deployment or push occurred in this continuation. Verify the production migration/runtime before releasing dependent UI. Local preview uses a fresh disposable identity and ignored private setup; those auth files and tokens must never be committed.

Read docs/codex-review/PENDING_ROLLOUT_VERIFICATION.md and docs/superpowers/plans/2026-10-08-remaining-rollout-execution.md first. Do not repeat completed Tasks 5–8 or follow the outdated stop/model/checklist instructions below.

## Historical transfer notes

This is a backup checkpoint, not a production release. Coding is paused at the user's request. Do not reset any database or discard dummy data.

## Current work

Task 5.2a correction contracts were committed at b316c40. Task 5.2b implements the private atomic debt correction handler, guarded public dispatcher patch, and database tests. Its independent review is still outstanding. Read `pending-rollout/task-5-2b-report.md` and inspect the actual diff before proceeding. No production SQL was executed for 5.2b.

Authoritative plan: `docs/superpowers/plans/2026-10-08-pending-rollout.md`. Detailed debt requirements: `docs/superpowers/plans/2026-10-07-existing-debt-selection.md` and the matching specification in `docs/superpowers/specs`.

Next, when the user authorizes coding: review 5.2b, then complete Tasks 6a/6b (debt snapshot, legacy adoption, existing debt forms), 7 (selection and unpaid corrections), 8 (description/title editing), and 9 (integrated verification and rollout). Check actual implementation before repeating any checklist item. Landing redesign remains deferred.

## Planning boundary

The user intends to make a fresh plan after transferring this checkpoint. This handoff records project status and requirements; it does not prescribe agent/model assignments. Let the user plan before coding.

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

Clone branch `beta-1.1`, run `npm ci`, and restore the private `.env`. Global skills are in the local backup's `global-skills`; copy them into the new user's `.agents/skills`. Project skills are tracked in this repository. Read AGENTS.md and resolve its skill instructions in the new session.

The local ZIP contains private setup and data exports. Keep it private. Do not commit those files. Codex login credentials are deliberately excluded: sign in again on the new PC. MCP config is a reference, not something to overwrite blindly; update absolute paths and reinstall dependencies. Application bundled skills/plugins are installed through the new Codex app.

The disposable DB harness is outside this repository on the old PC. The ZIP contains its runtime files and a logical dump when available. Restore only into a fresh local disposable database, never production. Existing cloud Supabase data stays on Supabase; Git is not a database backup.

Git and the handoff transfer files and working context. The chat share snapshot is read-only; it does not import a live editable chat or active agents. Start a new chat using RESUME_BETA_1_1_PROMPT.md.
