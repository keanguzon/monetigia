### Task 7: Optional spending limit UI

**Files**
- Create: `src/components/transactions/SpendingLimitDialog.tsx` (Radix Dialog, like the existing edit dialog on the page)
- Modify: `SpendingSummaryPanel.tsx`
- Test: `tests/spending-limit-ui.test.tsx`

**When the limit shows (decision table)**

| Limit saved | Limit cadence vs viewed period | Viewed period | Panel shows |
|---|---|---|---|
| No | n/a | any | Text button "Set spending limit" |
| Yes | month vs month view, or cutoff vs half view | current | Progress bar + "₱X of ₱Y used" + "₱Z left" or "₱Z over your limit" |
| Yes | matches | past | Spent only, plus a small note "Limit applies to the current period only" |
| Yes | doesn't match | any | Spent only, plus text button "Edit spending limit" |

**Dialog**
- Title: "Spending limit"
- Amount field: label "Limit amount (₱)", numeric, at most 2 decimals, must be greater than 0. Error: "Enter an amount greater than ₱0."
- Cadence: radio "Every month" / "Every cutoff (1st–15th, 16th–end)"
- Helper text: "This is a guide only. You can still record any expense."
- Buttons: **Save limit** (`variant="default"`), **Cancel**, and **Remove limit** (only when one exists; outline + destructive text). Remove asks for an inline confirm: "Remove your spending limit?"
- Escape and Cancel close without saving and return focus to the button that opened the dialog.
- Save failure keeps the dialog open with "The limit couldn't be saved. Try again."

**Tests**
- [ ] Each decision-table row renders the right content.
- [ ] Over-limit shows the destructive-token text, and recording more expenses is still possible (no code path reads the limit on submit; assert the transaction modal has no limit dependency).
- [ ] Validation for 0, negative, 3 decimals and an empty amount.
- [ ] Save, Remove (with confirm), Cancel/Escape focus return, save failure message.
- [ ] Run `npx vitest run`, then `npx tsc --noEmit`.
- [ ] Commit: `feat(transactions): add optional spending limit`

---


Controller integration notes (settled Task4 contracts):
Antislop active: during (session override). Use existing app UI/token rules, no redesign and no nested agents. src/hooks/use-spending.ts exports useSpendingLimit():{limit,error,isLoading}, undefined for unresolved/error and null only confirmed absence/signedout; useSpendingLimitCommand():{save(amount,cadence),remove(),isSaving,error}. Both command methods return {saved:SpendingLimitValue|null,refreshError:unknown|null} after confirmed writes. Treat refreshError as saved-but-refresh-failed; show useful state/retry refresh only, never replay a confirmed money preference write as a Retry. Validation/write/badreceipt/ownerchange throws. SpendingLimitValue={amount:string,cadence:'month'|'cutoff'}.
useSpendingOwner() exports userId,status,generation,isCurrent,capture; form must bind owner+generation and close/ignore stale submit completions when auth changes. Do not let old owner's saved receipt update new owner's dialog. Do not infer no-limit from read error, or expose create/edit with unknown persisted state. A narrowly additive retry on the limit-read hook is allowed if needed to recover UI; no rewriting Task4 owner or RPC protocols.
Preserve existing Task6 panel; read its props once then integrate. Full suite only Task8; focused RED/GREEN UI tests+typecheck. Exclude parent plan, generated tsconfig.json, pending-rollout SQL/docs and unrelated audit/chat files from commit. Git executable is C:/Users/PC/AppData/Local/Programs/Git/cmd/git.exe. Write task-7-report.md in this ignored workspace with exact evidence and scoped commit.
Contrast is a real acceptance gate: existing global destructive token can be low contrast, especially dark. Do not claim token use alone passes. Root will compute/inspect rendered over-limit text/bar both themes; if needed use accessible scoped treatment and tell root rather than change global theme or introduce ad-hoc green. Primary buttons must retain variant=default or required universal token classes. Existing app-wide contrast findings remain separate audit work.
