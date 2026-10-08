antislop active: during (session override).

# Task 2 spec and quality review

Reviewed the Task 2 brief, executor report, scoped review package, final source and test changes, and unchanged submission controller. This review made no product edits, ran no duplicate tests, and created no commits or subagents.

## Verdict

Spec: PASS under the root's documented Radix DOM-remount ruling. Quality: PASS after the two findings below were corrected. No open P1/P2 findings in the final scoped implementation. Root browser acceptance and integrated verification remain separate gates.

## Findings resolved before approval

1. P2: A stale fresh zero-release quote still offered customization when multiple goals were eligible. Reviewing zero custom amounts called the ordinary quote path, whose unchanged controller auto-saves zero-release quotes, bypassing renewed explicit confirmation. `src/components/transactions/GoalReleaseNotice.tsx:37` now requires a nonempty release list before showing customization. `tests/transaction-release.test.tsx:461` verifies the control is absent in the stale-zero case while the existing following assertions require a second explicit confirmation.
2. P2: Returning an identical quote after reviewing unchanged custom amounts preserved the notice's `custom` state because the old key only serialized the quote. Confirmation remained disabled after loading completed. `src/components/transactions/GoalReleaseDialog.tsx:25` now tracks a presentation revision after the busy cycle completes; its keyed notice at line 55 resets local customization even when the fingerprint and amounts are identical. The new final test in `tests/transaction-release.test.tsx` defers that identical response, checks confirmation stays disabled during quoting, then verifies it becomes enabled with zero writes until explicit confirmation. This revision never supplies a financial command or quote authority.

## Spec and quality evidence

- `AddTransactionModal.tsx:54` derives current review from the authoritative controller and excludes unresolved outcomes. Its retained display at line 56 applies only during quoting/saving. The callbacks at line 685 call existing controller methods; the retained quote never reaches `confirm` as an argument.
- `AddTransactionModal.tsx:340` switches the parent to nonmodal while review is open. Parent inert/aria-hidden handling at lines 62 and 343 and the child's separate body portal at `GoalReleaseDialog.tsx:38` give the child focus ownership. Initial Keep focus, busy dismissal prevention and connected-target cancellation restoration are explicit in the wrapper. The installed Radix implementation confirms the parent modal/nonmodal branches are distinct components and only the modal branch traps focus.
- `AddTransactionModal.tsx:78` captures/restores parent form scroll. Draft inputs remain controlled in the parent. Literal DOM preservation is not claimed: the root authorized retaining `modal={!reviewOpen}` with controlled draft preservation and explicit scroll restoration because installed Radix remounts the content branch.
- `GoalReleaseNotice.tsx:39`, line 48 and line 49 disable custom inputs and both footer actions while busy. Custom mode also disables confirmation until the returned quote is reviewed. Exact parsing, eligibility and sum validation remain unchanged.
- `AddTransactionModal.tsx:651` suppresses the parent's controller error while review owns the visible error. Unknown outcomes close review and focus the parent retry at line 73; known rejection/custom failure focus the parent error or submit at line 74. The unchanged controller retains request UUID/command/quote for unknown retry.
- The saved refresh-error status and disabled saved submit remain in the original fixed parent footer at `AddTransactionModal.tsx:661` and line 675. Successful refresh still closes through the existing effect at line 121. No child close callback duplicates that operation.
- Both parent content at `AddTransactionModal.tsx:343` and child content at `GoalReleaseDialog.tsx:40` carry the existing mobile-navigation blocking marker. The popup uses opaque theme surfaces, 44px controls, a scrollable content body, fixed actions and safe-area footer padding without adding motion, assets or dependencies.
- Product changes are limited to the three scoped transaction components and transaction-release tests. Hooks, financial contracts, refresh logic, SQL and dependencies are unchanged.

## Validation and limits

The executor reports observed failing regressions before the two fixes, then a fresh `npx vitest run tests/transaction-release.test.tsx` result of 36/36 passing, `npx tsc --noEmit` exit 0 and `git diff --check` exit 0. These commands were not rerun by this reviewer. Existing hook regressions remain present alongside the popup, deferred stale, zero-release, customization, idempotence, unknown recovery, rejection and refresh-failure cases.

The executor report records root's separate observations of the 375px popup, initial Keep focus, Escape returning to preserved amount and submit-button focus, navigation suppression after the marker correction, and 768/1280px layouts without overflow. Full rendered theme/long-row checks remain root-owned. Physical Safari keyboard/safe-area acceptance cannot be inferred from jsdom or static inspection. This report approves the scoped code; it does not claim the remaining acceptance gates passed.

## Declined to judge

- Literal parent form DOM identity: superseded by the root's explicit installed-Radix ruling; controlled draft and scroll preservation were reviewed instead.
- Physical Safari, complete rendered contrast/zoom/layout and whole-rollout deployment: outside this static review seat and owned by root/device acceptance.
- Existing submission-controller accounting and backend contract design: unchanged and outside Task 2 edit scope; their review/retry/stale-zero interfaces were checked for correct consumption.
