# Monetigia handoff, October 7, 2026

Read this before changing code. This records current work and the user's instructions; it does not grant permission to implement deferred features.

## Repository and current scope

- Repository: https://github.com/keanguzon/monetigia
- Development base: `beta`. Feature branch: `codex/goal-reservations`.
- Original main checkout: `C:/Users/PC/Documents/monetigia`.
- Active feature checkout: `C:/Users/PC/.codex/worktrees/goal-reservations/monetigia`.
- Goal reservation architecture tasks 1 through 11 were committed before this installment work. Previous HEAD was `d9592d0`; prior verification report is `docs/codex-review/GOAL_RESERVATIONS_VERIFICATION.md`.
- Latest scope: grouped installment history, purchase versus due dates, bounded full-history loading, modal polish, right-side expansion, dropdown inset, subtle press feedback, and iOS logo assets. See `docs/superpowers/plans/2026-10-07-installment-history.md` and `docs/codex-review/INSTALLMENT_HISTORY_VERIFICATION.md`.
- Latest instruction: local build/commit, user QA, then push. Do not push until user finishes QA and authorizes it. Do not merge into beta or deploy without separate authorization.
- Preserve local QA data and existing changes. Never reset the local database merely to obtain a clean fixture.

## User's working rules

- Antislop active: **during (session override)**. Read `AGENTS.md` and referenced workspace skills. Use Goals as the design reference, existing Manrope/Bricolage fonts, shared primary green. ENERGY 1 / RHYTHM 2 / MOTION 1.
- Use Subagent-Driven Development for meaningful implementation tasks, with specification and code review. Avoid spawning many agents for tiny changes.
- When Luna writes code, use **gpt-6-luna, max**. For lighter bounded testing/review, Luna medium or high. Never use below medium for Luna.
- Sol low/medium for work whose complexity warrants it. Sol high was allowed for the completed installment backend only. The later override removes new Sol high and Astra use. Do not infer that the earlier Astra permission still applies.
- No button bounce or press scaling on Transactions. Keep a restrained pressed indication. Only the installment schedule body animates on expansion/collapse, with reduced-motion support.
- Use actual evidence. Separate automated tests, agent review, browser checks, and user-reported QA. Do not call something tested merely because a test file exists. Silent TypeScript output alone does not record its exit status.
- Give short Taglish updates; explain the next QA step without assuming balances or goals that no longer exist.

## Financial invariants

- Wallet actual balance is real recorded cash. A reservation allocates money inside a normal wallet; it does not decrease actual balance or create an expense.
- Available = actual minus reserved. Credit/debt/PayLater accounts are never reservation wallets.
- Goal progress = reserved + actual spending toward that goal, shown separately. Funded is distinct from explicitly completed.
- Goal spending consumes reservation and records one expense atomically. Release increases available without a fake expense.
- Ordinary overspend within actual cash requires a reviewed release quote; cancellation saves nothing. Stale quotes reject, request UUID replay is idempotent.
- Deleting active-goal spending restores cash and applicable reservation atomically. Deleting completed-goal spending restores cash without reopening the goal or restoring a closed reservation.
- Legacy tagged transactions are not automatically adopted as live reservations.
- Financial mutations use authenticated atomic RPCs, owner checks, guards and idempotency. Do not replace these with direct client writes.

## Installment decisions

- Purchase date defaults to local today, editable. First due defaults one calendar month later and is separately editable; manual due edits survive unrelated changes.
- Subsequent due dates use the original first-due anchor: Jan 31, Feb 28/29, Mar 31. Exact centavo split; no duplicate purchase/debt row.
- `transactions.date` remains the installment due date. `purchase_date` and `installment_group_id` hold explicit purchase metadata. Generated `history_date` supports server sorting.
- Migration: `supabase/migrations/202610070001_installment_purchase_dates.sql`. Apply after the six October 6 migrations.
- Legacy grouping uses authoritative operation result IDs, never descriptions. Unknown purchase dates remain unknown. Legacy Transaction date sorting uses latest remaining due date, visibly labeled.
- Date added is default sort; Transaction date is alternate. Stable server tie-breakers. Load more fetches 50 source rows at a time and hydrates complete selected groups, with deduplication.
- Search/filter applies to **loaded history**, clearly labeled. This is not an all-history server search. Offset pagination is not a snapshot under concurrent external writes.
- Delete installment deletes only that row; group amount means remaining scheduled amount.
- Actual chosen debt-payment date determines the breakdown month. Independent historical billing attribution is deferred.

## QA and pending work

- User reported passing reservation/release/move, overspend decline/confirm, active and completed expense deletion, reopen at zero, and archive hiding a goal. These are user-reported, not fresh audit claims.
- Root browser tested a three-installment local disposable purchase, distinct purchase/due dates, Jan31 schedule, exact split, auto-close, grouping, keyboard expansion and individual deletion. Temporary acceptance rows were removed; existing user QA rows retained.
- Follow `INSTALLMENT_HISTORY_VERIFICATION.md` for current regression QA. Read wallet baselines first; GCash was previously zero, then funded for testing, so do not prescribe an assumed balance.
- Deferred, documentation only: overspend popup instead of inline notice; discoverable archived-goal restore; iOS-inspired glass mobile bottom navigation; useful Settings redesign. See `2026-10-07-manual-qa-follow-ups.md`. User has not approved the Settings feature selection/design.
- iOS icon PNG sizes and HTML/manifest URLs are verified locally. Physical Safari/iPhone Add to Home Screen is still a manual device check; manifest alone does not establish offline support.

## Continue on another PC

1. Before push, preserve the feature branch with a bundle. In the active feature checkout run `git bundle create monetigia-handoff.bundle codex/goal-reservations beta`, then `git bundle verify monetigia-handoff.bundle`. This captures committed Git history, not ignored files, live database data or the chat.
2. Copy the bundle and this handoff document to the other PC. Keep any required `.env` files in a separate private transfer, never a Git commit. The ignored local preview harness/database is not in the bundle; copy it only if you need the exact disposable QA state. Do not copy running database files while PostgreSQL is writing to them; use a proper dump or stop it first.
3. On the other PC run `git clone -b codex/goal-reservations <path-to-bundle> monetigia`. Then inside that checkout run `git remote set-url origin https://github.com/keanguzon/monetigia.git` and `npm ci`. Restore the environment privately. Do not use production credentials for disposable QA.
4. If the branch has already been pushed, cloning GitHub and checking out `codex/goal-reservations` replaces the bundle step. Verify `git log -5 --oneline` and `git status` against the source PC.
5. Open that folder in your AI tool. Give it the prompt below. Source-PC absolute paths are historical; the new checkout path is authoritative.
6. For an ordinary local server run `npm run dev`; use the port it prints. The old isolated harness uses app port 3107, auth helper 3108 and a local PostgreSQL/API stack. Those ports/helpers do not exist automatically after cloning.

Copy this prompt to the new AI:

> Continue Monetigia from the current `codex/goal-reservations` checkout. First read AGENTS.md, docs/codex-review/CONTINUE_ON_ANOTHER_PC.md, docs/codex-review/INSTALLMENT_HISTORY_VERIFICATION.md, and both October 7 plans. Antislop during is active. Preserve financial invariants and local data. Use Luna max for Luna coding and medium/high for lighter checks; Sol low/medium when warranted; no new Astra or Sol high. Use subagents with review for meaningful tasks. Tell me the actual branch/status and next manual QA step. Do not implement deferred Settings/navigation/restore/popup scope, push, merge or deploy without my instruction. Never invent prior test results or assume fixture balances.

The Git bundle does not contain this conversation. This document supplies portable project context. A copied chat transcript can supplement it, but the receiving AI should verify current source/status rather than treating old statements as current results.
