# Task 6a.2 implementation

Implemented on beta-1.1 after reviewed Task 6a.1 at e18cc2c. Production files are frozen for independent review. No SQL, UI, database execution, installation, commit or push was performed.

## Changed files and behavior

- `src/lib/debt/client.ts`: validated atomic `debt_account_create` transport; canonical decimal snapshot validation; expected-owner/session-token binding and post-response identity check. Creation shares the financial error classifiers: explicit rejection is rejected, thrown transport/5xx/malformed success is unknown.
- `src/hooks/use-debt.ts`: exact `['debtSnapshot', userId]` SWR key, session and identity revision guards, same-user token-renewal recovery, signout clearing, owner-scoped refresh. Separate module-level owner-keyed creation/command controllers retain immutable parsed payloads and the original UUID across unmount/remount/routes and explicit retries. Duplicate submission and reset cannot replace saving/unknown work. Known server rejection releases the attempt for editing; saved writes clear the attempt before refresh.
- `src/lib/goals/client.ts`: exports the existing classifiers as `readFinancialRpcError` and `unknownFinancialOutcome`, preserving their semantics and updating existing callers. Root authorized optional `expectedUserId` on `applyFinancialCommand`, plus shared `financialOwnerToken` and `FinancialSessionMismatchError` for pre-dispatch checks. Existing goal callers omit the optional parameter and retain their behavior.
- `src/lib/refresh-financial-data.ts`: includes only the selected owner's debt snapshot in existing scoped invalidation/error reporting.
- `tests/debt-client.test.ts`, `tests/debt-hooks.test.tsx`, `tests/goal-finance-client.test.ts`: transport, recovery, ownership, immutable payload, refresh and existing classifier coverage.

Root also authorized optional `expectedUserId` on `createDebtAccount`. Debt hooks pass the original owner, verify `getUser` before every attempt, then pin the session token on the actual RPC. A late selected-owner change prevents dispatch. A session mismatch detected before dispatch has existing NOT_ALLOWED/rejected semantics; if an older write already has an unknown outcome, that mismatch retains the older immutable attempt for original-owner recovery rather than declaring it resolved.

The prescribed hook API additionally exposes deeply readonly `pendingInput`/`pendingCommand`, as ruled by root, so later dialogs can show the original account/draft/target on reopening. Neither exposes the request ID or mutable attempt. Zod parsing copies nested payloads; recursive freezing prevents consumer mutation. Caller mutation after the first unknown response cannot change the retry payload.

Successful-save/failed-refresh state retains `saved` and `refreshError`, blocks another write/reset and offers refresh-only recovery via `useDebt.refresh`. A successful explicit refresh clears that owner's refresh error while retaining the saved receipt. No automatic replay, localStorage financial payload, offline writes or background retry was added.

## RED/GREEN and current verification

Executed on 2026-10-08:

- Initial client run exposed the missing module. An empty export stub allowed test collection; `npx vitest run tests/debt-client.test.ts` then failed 7/7 because the new APIs were absent. Implementation GREEN: 7/7, with existing client 8/8.
- Initial `npx vitest run tests/debt-hooks.test.tsx` failed 9/9 because the new hooks were absent. Initial controller/snapshot implementation GREEN: 9/9.
- Extended hook suite RED: 3 failures (both saved-refresh-failure cases and scoped debt invalidation) because debtSnapshot was absent from refresh matching. Adding the exact key produced GREEN 13/13.
- Owner-bound creation RED: 2 failures (different-owner rejection and pinned token absent). Optional owner binding produced GREEN.
- Retry pre-dispatch session mismatch RED: 2 failures because rejection discarded prior unknown create/command work. Distinguishing pre-dispatch session mismatch produced GREEN 18/18 hooks.
- Latest required focused command: `npx vitest run tests/debt-client.test.ts tests/debt-hooks.test.tsx tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx tests/transaction-release.test.tsx tests/wallet-reservations.test.tsx`: **107/107 across 6 files**, exit 0 (6.04 seconds). Per-file counts: 11, 18, 9, 15, 36, 18 respectively.
- `npx tsc --noEmit`: **passed**, exit 0.
- Full `npm test` executed once after production changes and final test additions: **Node 7/7 and Vitest 315/315 across 26 files**, exit 0; Vitest duration 14.00 seconds. No failing test was omitted.
- `git diff --check`: **passed**, exit 0.

Coverage includes canonical decimal RPC payload/result, malformed success unknown, network/5xx unknown, named conflict rejection, no automatic replay, duplicate clicks, saving/reset protection, immutable same-ID recovery after remount, cross-owner hiding, delayed getUser race, pre-dispatch session mismatch, pinned tokens, out-of-order snapshots, token renewal, signout clearing, correction dispatch and saved-refresh-failed versus rejected-save states.

Antislop code gate PASS: no new production comments or decorative narration; the existing financial malformed-response comment still explains the commit ambiguity. No UI/copy/layout work occurred in this unit. Existing untracked user files `implementation_plan.md` and `mema.md` were preserved.

Independent review, root commit and production/device acceptance remain separate steps. There is no database lane for this client-only unit.
