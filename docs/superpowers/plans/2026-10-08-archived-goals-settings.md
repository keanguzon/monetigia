# Archived Goals in Settings

User authorized implementation and deployment, matching existing Settings design. Preserve all existing records; no reset. Antislop during remains active. Luna max implements, Sol medium reviews.

## Design

Add an Archived Goals section using Settings' current section grid, heading/body fonts, borders and light/dark tokens. List goal name, lifecycle status, target and archive date. A 44px outlined Restore action unarchives the goal without reopening it or restoring released reservations. Reopen remains a separate action on Goals. Include truthful loading, empty, error/retry and save-feedback states; unknown writes retry the same request identifier rather than creating a second operation.

## Tasks

1. Add an additive migration for an owner-authorized restore operation. Preserve status, spent history and account balances. Reuse existing owner locking/idempotence patterns; restrictive grants and pinned search_path. Test cross-user/anonymous denial, replay and unchanged financial values on the disposable database.
2. Add a validated client call and Settings component using the user-scoped snapshot (which includes archived goals). Refresh shared financial data after save; distinguish a saved operation from failed refresh. Test loading/empty/error, restore, duplicate prevention and unknown outcome.
3. Review bounded source/DB security and UI. Run focused and full tests, typecheck, lint, production build and responsive/light-dark checks. Record exact results and limits.
4. Apply the new production migration before deploying dependent UI. Agent lacks authenticated production database access: present the tested exact migration for user execution, verify RPC existence, then commit/merge/push main under existing deployment authorization. Do not call the feature deployed until this prerequisite is satisfied.

## Deferred

Existing-debt schedules, transaction title editing, bulk selection, mobile glass navigation and overspend popup remain separate scope.
